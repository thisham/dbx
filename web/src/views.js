import sqlParser from 'node-sql-parser';
import { Parser, ModelExporter } from '@dbml/core';
import { tokenize } from './highlight.js';
const parser = new sqlParser.Parser();
const dialects = {postgres:'Postgresql',mysql:'MySQL',mssql:'TransactSQL'};
const q = value => '"' + value.replaceAll('"','""') + '"';
const literal = value => "'" + value.replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r') + "'";
export const isView = table => table.metadata?.dbx_kind === 'view';

// Preserve comments and strings verbatim while recognizing the optional ViewTable shorthand.
export function normalizeViewTables(source) {
  const tokens=tokenize(source);let offset=0,depth=0,view=false,settingsEnd=null;const edits=[];
  for(const token of tokens){
    if(!token.kind && /^\s*$/.test(token.text)){offset+=token.text.length;continue;}
    if(token.kind==='comment'||token.kind==='string'||token.kind==='identifier'){offset+=token.text.length;continue;}
    if(depth===0 && token.text.toLowerCase()==='viewtable' && (/^\s*$/.test(source.slice(source.lastIndexOf('\n',offset-1)+1,offset)) || source.slice(0,offset).trimEnd().endsWith('}'))){edits.push({start:offset,end:offset+token.text.length,text:'Table'});view=true;settingsEnd=null;}
    if(view && depth===0 && token.text===']') settingsEnd=offset;
    if(token.text==='{'){
      if(view && depth===0){edits.push(settingsEnd===null?{start:offset,end:offset,text:"[dbx_kind: 'view'] "}:{start:settingsEnd,end:settingsEnd,text:", dbx_kind: 'view'"});view=false;}
      depth++;
    }
    if(token.text==='}')depth--;
    offset+=token.text.length;
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  return source;
}

// SQL token boundaries only. Query syntax and projection analysis belong to the SQL parser.
export function sqlTokens(source) {
  const out=[];let i=0;
  while(i<source.length){
    const start=i,c=source[i];
    if(/\s/.test(c)){i++;continue;}
    if(source.startsWith('--',i)){while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(source.startsWith('/*',i)){i+=2;let depth=1;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)throw new Error('Unterminated SQL comment.');continue;}
    const dollar=source.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/);
    if(dollar){i+=dollar[0].length;const end=source.indexOf(dollar[0],i);if(end<0)throw new Error('Unterminated SQL string.');i=end+dollar[0].length;out.push({text:source.slice(start,i),value:source.slice(start,i),start,end:i,quoted:true});continue;}
    if("'\"`[".includes(c)){
      const close=c==='['?']':c;let value='',closed=false;i++;
      while(i<source.length){if(source[i]===close){if(source[i+1]===close){value+=close;i+=2;}else{i++;closed=true;break;}}else if(source[i]==='\\'&&c!== '['){value+=source.slice(i,i+2);i+=2;}else value+=source[i++];}
      if(!closed)throw new Error('Unterminated SQL quoted value.');out.push({text:source.slice(start,i),value,start,end:i,quoted:true});continue;
    }
    const word=source.slice(i).match(/^[\w$]+/);if(word)i+=word[0].length;else i++;
    out.push({text:source.slice(start,i),value:source.slice(start,i),start,end:i,quoted:false});
  }
  return out;
}
export function splitSQL(source) {
  const pieces=[];let start=0;
  for(const token of sqlTokens(source)){
    if(token.text===';'){pieces.push(source.slice(start,token.end));start=token.end;}
    else if(!token.quoted && token.text.toUpperCase()==='GO' && source.slice(source.lastIndexOf('\n',token.start-1)+1,source.indexOf('\n',token.end)<0?source.length:source.indexOf('\n',token.end)).trim().toUpperCase()==='GO'){if(source.slice(start,token.start).trim())pieces.push(source.slice(start,token.start));start=token.end;}
  }
  if(source.slice(start).trim())pieces.push(source.slice(start));return pieces;
}
function readView(statement) {
  const tokens=sqlTokens(statement);let i=0;
  const take=word=>{if(tokens[i]?.text.toUpperCase()===word){i++;return true;}return false;};
  if(!take('CREATE'))return null;
  if(take('OR')){if(!take('REPLACE')&&!take('ALTER'))throw new Error('Expected REPLACE or ALTER.');}
  if(take('MATERIALIZED'))throw new Error('Materialized views are not supported yet. Use a regular CREATE VIEW.');
  if(!take('VIEW')) {
    if(tokens.slice(i,i+6).some(t=>!t.quoted&&t.text.toUpperCase()==='VIEW')) throw new Error('Unsupported CREATE VIEW options. Use CREATE VIEW name AS SELECT … .');
    return null;
  }
  if(!tokens[i])throw new Error('A view needs a name.');
  let schema=null,name=tokens[i++].value;
  if(take('.')){schema=name;name=tokens[i++]?.value;}
  const columns=[];
  if(take('(')){while(tokens[i]&&tokens[i].text!==')'){columns.push(tokens[i++].value);if(!take(','))break;}if(!take(')'))throw new Error('Invalid view column list.');}
  if(!take('AS'))throw new Error('Expected AS followed by a SELECT query in CREATE VIEW.');
  const query=statement.slice(tokens[i-1].end).trim().replace(/;\s*$/,'');
  return {schema,name,columns,query};
}
const columnName = value => typeof value === 'string' ? value : value?.expr?.value ?? value?.value;
export function analyzeQuery(query, dialect, tables=[], explicitNames=[]) {
  const options={database:dialects[dialect]};
  query=query.trim().replace(/;\s*$/,'');
  const ast=parser.astify(query,options);
  if(Array.isArray(ast)||ast?.type!=='select')throw new Error('A view query must contain exactly one SELECT statement.');
  const known = (schema,name) => {
    const matches=tables.filter(t=>t.name===name && (!schema || t.schema===schema));
    return matches.length===1 ? matches[0] : matches.find(t=>t.schema===(dialect==='mssql'?'dbo':'public'));
  };
  const sources=(ast.from||[]).map(f=>({alias:f.as||f.table,table:known(f.db,f.table)}));
  const columns=[];
  const projection=ast.columns==='*'?[{expr:{type:'column_ref',column:'*'}}]:ast.columns;
  for(const item of projection||[]){
    const expr=item.expr,name=columnName(expr?.column);
    if(name==='*'||expr?.type==='star'){
      const matches=sources.filter(s=>!expr.table||s.alias===expr.table);
      if(!matches.length||matches.some(s=>!s.table))throw new Error('Cannot resolve SELECT *. Include the source tables or use explicit output columns.');
      for(const source of matches)for(const f of source.table.fields)columns.push({name:f.name,type:f.type,source:source.table.id,fieldId:f.id});
    }else{
      const matches=sources.filter(s=>(!expr?.table||s.alias===expr.table)&&s.table?.fields.some(f=>f.name===name));
      const direct=expr?.type==='column_ref'&&matches.length===1?matches[0].table:null;
      const field=direct?.fields.find(f=>f.name===name);
      const outputName=explicitNames[columns.length]||item.as||name;
      if(!outputName)throw new Error('Give every computed view column an AS alias or an explicit view column name.');
      columns.push({name:columnName(outputName),type:field?.type||{type_name:'unknown',args:null,schemaName:null},source:direct?.id,fieldId:field?.id});
    }
  }
  if(explicitNames.length&&explicitNames.length!==columns.length)throw new Error('The view column list must match the SELECT output.');
  columns.forEach((c,i)=>{if(explicitNames[i])c.name=explicitNames[i];});
  if(!columns.length||new Set(columns.map(c=>c.name)).size!==columns.length)throw new Error('View columns must have distinct names. Add explicit aliases.');
  const dependencies=[];
  for(const entry of parser.tableList(query,options)){
    const [,schema,name]=entry.split('::');const table=known(schema==='null'?null:schema,name);if(table&&!dependencies.includes(table.id))dependencies.push(table.id);
  }
  return {columns,dependencies};
}
export function importSQL(source,dialect) {
  const definitions=[],regular=[];
  for(const statement of splitSQL(source)){const view=readView(statement);if(view)definitions.push(view);else regular.push(statement);}
  let dbml=ModelExporter.export(new Parser().parse(regular.join('\n'),dialect),'dbml');
  const pending=[...definitions];let lastError;
  while(pending.length){let progressed=false;
    for(const definition of [...pending]){
      try{
        const database=new Parser().parse(dbml,'dbmlv2'),model=database.normalize();
        const tables=Object.values(model.tables).map(t=>({...t,schema:model.schemas[t.schemaId].name,fields:t.fieldIds.map(id=>model.fields[id])}));
        const info=analyzeQuery(definition.query,dialect,tables,definition.columns);
        const schema=definition.schema || 'public', name=`${q(schema)}.${q(definition.name)}`;
        let candidate=dbml+`\nTable ${name} [dbx_kind: 'view', dbx_dialect: ${literal(dialect)}, dbx_query: ${literal(definition.query)}] {\n${info.columns.map(f=>`  ${q(f.name)} ${/\s/.test(f.type.type_name)?q(f.type.type_name):f.type.type_name}`).join('\n')}\n}\n`;
        new Parser().parse(candidate,'dbmlv2');dbml=candidate;pending.splice(pending.indexOf(definition),1);progressed=true;
      }catch(error){lastError=error;}
    }
    if(!progressed)throw lastError;
  }
  const finalModel=new Parser().parse(dbml,'dbmlv2').normalize();
  const finalTables=Object.values(finalModel.tables).map(t=>({...t,schema:finalModel.schemas[t.schemaId].name,fields:t.fieldIds.map(id=>finalModel.fields[id])}));
  for(const view of finalTables.filter(isView)){
    const info=analyzeQuery(view.metadata.dbx_query,dialect,finalTables,view.fields.map(f=>f.name));
    for(const id of info.dependencies){const t=finalTables.find(t=>t.id===id);dbml+=`Dep: ${q(t.schema)}.${q(t.name)} -> ${q(view.schema)}.${q(view.name)}\n`;}
  }
  new Parser().parse(dbml,'dbmlv2');
  return dbml;
}
export function exportSQL(database,dialect) {
  const model=database.normalize(),views=Object.values(model.tables).filter(isView);
  if(!views.length)return ModelExporter.export(database,dialect);
  const viewIds=new Set(views.map(v=>v.id));
  if(Object.values(model.endpoints).some(e=>e.fieldIds.some(id=>viewIds.has(model.fields[id].tableId))))throw new Error('SQL views cannot participate in foreign keys. Use data lineage dependencies instead.');
  const statements=[];
  const identifier=name=>dialect==='mysql'?'`'+name.replaceAll('`','``')+'`':dialect==='mssql'?'['+name.replaceAll(']',']]')+']':q(name);
  const pending=[...views],done=new Set(Object.values(model.tables).filter(t=>!isView(t)).map(t=>t.id));
  while(pending.length){let progressed=false;
    for(const view of [...pending]){
      const tableName=model.schemas[view.schemaId].name+'.'+view.name;
      const query=view.metadata.dbx_query;
      if(!query)throw new Error(`View ${tableName} needs a defining SQL query before SQL export.`);
      if(view.metadata.dbx_dialect!==dialect)throw new Error(`View ${tableName} uses ${view.metadata.dbx_dialect}. Export that dialect or update its query and dialect first.`);
      const tables=Object.values(model.tables).map(t=>({...t,schema:model.schemas[t.schemaId].name,fields:t.fieldIds.map(id=>model.fields[id])}));
      const info=analyzeQuery(query,dialect,tables,view.fieldIds.map(id=>model.fields[id].name));
      if(info.dependencies.some(id=>!done.has(id)))continue;
      const schema=model.schemas[view.schemaId].name;
      statements.push(`CREATE VIEW ${schema==='public'?'':identifier(schema)+'.'}${identifier(view.name)} (${view.fieldIds.map(id=>identifier(model.fields[id].name)).join(', ')}) AS\n${query.trim().replace(/;\s*$/,'')};`);
      done.add(view.id);pending.splice(pending.indexOf(view),1);progressed=true;
    }
    if(!progressed)throw new Error('Views have cyclic dependencies. Resolve the cycle before SQL export.');
  }
  for(const view of views){model.schemas[view.schemaId].tableIds=model.schemas[view.schemaId].tableIds.filter(id=>id!==view.id);view.fieldIds.forEach(id=>delete model.fields[id]);delete model.tables[view.id];}
  model.deps={};model.depEdges={};Object.values(model.schemas).forEach(s=>s.depIds=[]);
  const ddl=ModelExporter.export(model,dialect);
  return ddl+(dialect==='mssql'&&ddl.trim()&&!/\bGO\s*$/i.test(ddl)?'\nGO\n':'\n')+statements.join(dialect==='mssql'?'\nGO\n\n':'\n\n')+'\n';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {parse,describe,convert,saveTable,deleteTable,saveDependency,deleteDependency,typeName,isView} from './schema.js';
import {tokenize} from './highlight.js';
import {splitSQL} from './views.js';
const inspect=s=>describe(parse(s));
const spec=t=>({name:t.name,schema:t.schema,fields:t.fields.map(f=>({...f,type:typeName(f)}))});
const base='Table a {\n id int [pk]\n amount decimal(10,2)\n}\nTable b {\n id int\n amount decimal(10,2)\n}';

test('highlighting is lossless for comments, quoted keywords, multiline strings and incomplete code',()=>{
 const source="// Table fake {\nTable real {\n id int [pk]\n Note: '''a\nb <script>alert(1)</script>'''\n}\nDep: real -> another\n'partial";
 const tokens=tokenize(source);assert.equal(tokens.map(t=>t.text).join(''),source);
 assert.ok(tokens.some(t=>t.text==='Table'&&t.kind==='keyword'));assert.ok(tokens.some(t=>t.text==='int'&&t.kind==='type'));
 assert.ok(tokens.some(t=>t.text.startsWith("'''a")&&t.kind==='string'));
 assert.ok(tokenize('CREATE VIEW v AS SELECT 1 AS x; -- hi','sql').some(t=>t.text==='SELECT'&&t.kind==='keyword'));
});
test('dependency blocks retain names, color, notes and metadata through visual editing',()=>{
 const source=base+"\nDep transform [color: #abcdef] {\n a -> b\n note: 'transform'\n owner: 'data-team'\n query: 'SELECT id FROM a'\n}";
 const t=inspect(source).tables[0],edit=spec(t);edit.name='renamed';
 const next=saveTable(source,t.id,edit),edge=inspect(next).lineage[0];
 assert.equal(edge.upstream.tableName,'renamed');assert.equal(edge.dependency.name,'transform');assert.equal(edge.dependency.color,'#abcdef');assert.equal(edge.dependency.metadata.owner,'data-team');assert.equal(edge.dependency.note,'transform');
});
test('table, column and mixed lineage can be created, updated and removed',()=>{
 const tables=inspect(base).tables;let source=base;
 for(const [from,to] of [[[],[]],[[tables[0].fields[0].id],[tables[1].fields[0].id]],[[],[tables[1].fields[1].id]]])source=saveDependency(source,null,{tableId:tables[0].id,fieldIds:from},{tableId:tables[1].id,fieldIds:to},'derive');
 assert.equal(inspect(source).lineage.length,3);
 const edge=inspect(source).lineage[0];source=saveDependency(source,edge.id,{tableId:tables[0].id,fieldIds:[]},{tableId:tables[1].id,fieldIds:[]},"A 'quoted' note\nsecond line");
 assert.match(inspect(source).lineage[0].dependency.note,/quoted/);
 source=deleteDependency(source,inspect(source).lineage[0].id);assert.equal(inspect(source).lineage.length,2);
 const t=inspect(source).tables[1];assert.equal(inspect(deleteTable(source,t.id)).lineage.length,0);
});
test('column rename and deletion update dependent lineage',()=>{
 let source=base+'\nDep: a.id -> b.id';let t=inspect(source).tables[0],edit=spec(t);edit.fields[0].name='key';
 source=saveTable(source,t.id,edit);assert.deepEqual(inspect(source).lineage[0].upstream.fieldNames,['key']);
 t=inspect(source).tables[0];edit=spec(t);edit.fields=edit.fields.slice(1);source=saveTable(source,t.id,edit);assert.equal(inspect(source).lineage.length,0);
});
for(const dialect of ['postgres','mysql','mssql'])test(`${dialect} views and their queries round trip without becoming tables`,()=>{
 const sql='CREATE TABLE orders (id integer, amount decimal(10,2)); CREATE VIEW order_report AS SELECT id, amount FROM orders;';
 const dbml=convert(sql,'sql','dbml',dialect),view=inspect(dbml).tables.find(isView);
 assert.equal(view.name,'order_report');assert.equal(view.fields.length,2);assert.equal(inspect(dbml).lineage.length,1);
 const out=convert(dbml,'dbml','sql',dialect);assert.match(out,/CREATE VIEW/);assert.doesNotMatch(out,/CREATE TABLE ["`\[]order_report/);
 assert.equal(inspect(convert(out,'sql','dbml',dialect)).tables.filter(isView).length,1);
});
test('view shorthand, settings and query metadata survive visual editing',()=>{
 const source=base+"\nViewTable v [dbx_query: 'SELECT id FROM a', dbx_dialect: 'postgres'] {\n id int\n}";
 const view=inspect(source).tables.find(isView);assert.ok(view);
 const edit=spec(view);edit.name='report';const next=saveTable(source,view.id,edit);assert.equal(inspect(next).tables.find(isView).name,'report');assert.match(convert(next,'dbml','sql'),/CREATE VIEW "report"/);
 assert.equal(inspect("// ViewTable ignored {\nTable t {\n note text [note: 'ViewTable fake {}']\n}").tables.filter(isView).length,0);
});
test('SQL lexer keeps string/comment semicolons and SQL Server batches intact',()=>{
 const parts=splitSQL("-- hi;\nCREATE TABLE t (id int);\nGO\nCREATE VIEW v AS SELECT ';' AS x; /* ; */");assert.equal(parts.filter(p=>p.includes('CREATE')).length,2);
 const dbml=convert("CREATE TABLE t (id int); CREATE VIEW v AS SELECT ';' AS x FROM t;",'sql','dbml');assert.equal(inspect(dbml).tables.find(isView).fields[0].name,'x');
});
test('wildcards, explicit names, joins and aggregates produce view nodes',()=>{
 const sql='CREATE TABLE a (id int); CREATE TABLE b (a_id int); CREATE VIEW v AS SELECT a.id, COUNT(*) AS total FROM a JOIN b ON a.id=b.a_id GROUP BY a.id; CREATE VIEW copy (new_id) AS SELECT * FROM a;';
 const v=inspect(convert(sql,'sql','dbml'));assert.equal(v.tables.filter(isView).length,2);assert.equal(v.tables.find(t=>t.name==='copy').fields[0].name,'new_id');assert.equal(v.tables.find(t=>t.name==='v').fields[1].type.type_name,'unknown');assert.equal(v.lineage.length,3);
});
test('forward view dependencies export in dependency order',()=>{
 const dbml=convert('CREATE TABLE a (id int); CREATE VIEW z AS SELECT * FROM v; CREATE VIEW v AS SELECT * FROM a;','sql','dbml');
 const sql=convert(dbml,'dbml','sql');assert.ok(sql.indexOf('CREATE VIEW "v"')<sql.indexOf('CREATE VIEW "z"'));assert.equal(inspect(dbml).lineage.length,2);
});
test('views without queries and incompatible query dialects fail export explicitly',()=>{
 assert.throws(()=>convert('ViewTable v {\n id int\n}','dbml','sql'),/defining SQL query/);
 const source=convert('CREATE TABLE a (id int); CREATE VIEW v AS SELECT id FROM a;','sql','dbml');
 assert.throws(()=>convert(source,'dbml','sql','mysql'),/uses postgres/);
 const t=inspect(source).tables[0],edit=spec(t);edit.name='renamed';assert.throws(()=>saveTable(source,t.id,edit),/view depends/);
 assert.throws(()=>convert('CREATE VIEW v AS SELECT * FROM missing;','sql','dbml'),/Cannot resolve/);
});
test('ViewTable text in a regular table name is not treated as a declaration',()=>{
 const source='Table ViewTable {\n id int\n}';assert.equal(inspect(source).tables[0].name,'ViewTable');assert.equal(inspect(source).tables.filter(isView).length,0);
});

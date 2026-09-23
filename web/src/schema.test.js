import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE, parse, describe, convert, saveTable, deleteTable, addRelationship, deleteRelationship, typeName } from './schema.js';
const inspect = source => describe(parse(source));
const specFor = table => ({name:table.name,schema:table.schema,fields:table.fields.map(f=>({...f,type:typeName(f)}))});

test('sample parses with all tables and relationships', () => {
  const v = inspect(SAMPLE); assert.equal(v.tables.length,4); assert.equal(v.refs.length,3);
});
for (const dialect of ['postgres','mysql','mssql']) test(`${dialect} SQL round trip preserves tables, columns and foreign keys`, () => {
  const sql = convert(SAMPLE,'dbml','sql',dialect);
  assert.match(sql,/CREATE TABLE/i);
  const result = inspect(convert(sql,'sql','dbml',dialect));
  assert.equal(result.tables.length,4); assert.equal(result.refs.length,3);
  assert.deepEqual(result.tables.map(t=>t.fields.map(f=>f.name)),inspect(SAMPLE).tables.map(t=>t.fields.map(f=>f.name)));
});
test('rename a referenced column and table preserves defaults, notes, indexes and relationships', () => {
  const source = `Table customers {\n id int [pk]\n name varchar(100) [default: 'friend', note: 'display name']\n indexes {\n name [unique]\n }\n}\nTable orders {\n id int [pk]\n customer_id int [ref: > customers.id]\n}`;
  const table = inspect(source).tables[0], spec = specFor(table);
  spec.name = 'people'; spec.fields[0].name = 'person_id'; spec.fields[1].name = 'full_name';
  const next = saveTable(source,table.id,spec), v = inspect(next);
  assert.equal(v.refs.length,1); assert.ok(v.refs[0].endpoints.some(e=>e.tableName==='people' && e.fieldNames[0]==='person_id'));
  assert.match(next,/full_name \[unique\]/); assert.match(next,/default: 'friend'/); assert.match(next,/display name/);
});
test('remove a referenced column cleans foreign keys and dependent indexes', () => {
  const table = inspect(SAMPLE).tables.find(t=>t.name==='orders'), spec = specFor(table);
  spec.fields = spec.fields.filter(f=>f.name!=='customer_id');
  const result = inspect(saveTable(SAMPLE,table.id,spec)); assert.equal(result.refs.length,2);
});
test('new tables, column types and schemas are valid', () => {
  const next = saveTable('',null,{name:'line items',schema:'sales',fields:[{name:'id',type:'integer',pk:true},{name:'amount',type:'decimal(12,2)',not_null:true}]});
  const table = inspect(next).tables[0]; assert.equal(table.name,'line items'); assert.equal(table.schema,'sales'); assert.equal(typeName(table.fields[1]),'decimal(12,2)');
});
test('deleting table removes only its relationships', () => {
  const table = inspect(SAMPLE).tables.find(t=>t.name==='products');
  const v = inspect(deleteTable(SAMPLE,table.id)); assert.equal(v.tables.length,3); assert.equal(v.refs.length,2);
});
test('add and delete relationship including schema-qualified identifiers', () => {
  const source = 'Table sales.a {\n id int [pk]\n}\nTable sales.b {\n id int\n}', v = inspect(source);
  const next = addRelationship(source,v.tables[1].fields[0].id,v.tables[0].fields[0].id,'>');
  assert.equal(inspect(next).refs.length,1);
  assert.equal(inspect(deleteRelationship(next,inspect(next).refs[0].id)).refs.length,0);
});
test('reject duplicate columns, duplicate tables and invalid code', () => {
  assert.throws(()=>parse('Table broken {'));
  assert.throws(()=>saveTable(SAMPLE,null,{schema:'public',name:'customers',fields:[{name:'id',type:'int'}]}));
  assert.throws(()=>saveTable('',null,{schema:'public',name:'t',fields:[{name:'id',type:'int'},{name:'id',type:'text'}]}));
});
test('composite foreign keys and indexes survive an unrelated visual edit', () => {
  const source = 'Table parents {\n a int\n b int\n indexes {\n (a,b) [pk]\n }\n}\nTable children {\n a int\n b int\n}\nRef: children.(a,b) > parents.(a,b)';
  const table = inspect(source).tables[0], spec = specFor(table); spec.fields.push({name:'label',type:'text'});
  const next = saveTable(source,table.id,spec), v = inspect(next);
  assert.equal(v.refs[0].endpoints[0].fieldNames.length,2); assert.match(next,/\(a, b\) \[pk\]/);
});
test('empty schema exports and deleting the last table works', () => {
  assert.equal(inspect('').tables.length,0);
  const source = 'Table single {\n id int\n}';
  assert.equal(inspect(deleteTable(source,inspect(source).tables[0].id)).tables.length,0);
});
test('visual save preserves enums and multiword types', () => {
  const source = 'Enum state {\n active\n inactive\n}\nTable users {\n id int\n state state\n created_at "timestamp with time zone"\n}';
  const t = inspect(source).tables[0];
  const next = saveTable(source,t.id,specFor(t));
  assert.match(next,/Enum "state"/); assert.match(next,/timestamp with time zone/);
  assert.equal(inspect(next).tables[0].fields.length,3);
});
test('a moved table updates foreign keys across schemas', () => {
  const t = inspect(SAMPLE).tables.find(t=>t.name==='customers'), spec = specFor(t); spec.schema = 'crm';
  const v = inspect(saveTable(SAMPLE,t.id,spec));
  assert.equal(v.tables.find(t=>t.name==='customers').schema,'crm');
  assert.ok(v.refs.some(r=>r.endpoints.some(e=>e.tableName==='customers' && e.schemaName==='crm')));
});

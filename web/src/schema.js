import { Parser, ModelExporter } from '@dbml/core';

export const SAMPLE = `// Commerce · a small schema to explore
Table customers {
  id integer [pk, increment]
  name varchar(120) [not null]
  email varchar(255) [not null, unique]
  created_at timestamp [default: \`now()\`]
}

Table orders {
  id integer [pk, increment]
  customer_id integer [not null]
  status varchar(30) [default: 'pending']
  total decimal(12,2) [not null]
  created_at timestamp
}

Table order_items {
  id integer [pk, increment]
  order_id integer [not null]
  product_id integer [not null]
  quantity integer [not null, default: 1]
}

Table products {
  id integer [pk, increment]
  name varchar(160) [not null]
  price decimal(12,2) [not null]
  sku varchar(40) [unique]
}

Ref: orders.customer_id > customers.id
Ref: order_items.order_id > orders.id
Ref: order_items.product_id > products.id
`;

export function parse(source, language = 'dbml', dialect = 'postgres') {
  return new Parser().parse(source, language === 'dbml' ? 'dbmlv2' : dialect);
}
export function convert(source, from, to, dialect = 'postgres') {
  if (from === to) { parse(source, from, dialect); return source; }
  return ModelExporter.export(parse(source, from, dialect), to === 'sql' ? dialect : 'dbml');
}
export function describe(database) {
  const model = database.normalize();
  return {
    tables: Object.values(model.tables).map(t => ({...t,
      schema: model.schemas[t.schemaId].name,
      fields: t.fieldIds.map(id => model.fields[id]),
    })),
    refs: Object.values(model.refs).map(r => ({...r, endpoints: r.endpointIds.map(id => ({...model.endpoints[id], tableId: model.fields[model.endpoints[id].fieldIds[0]].tableId}))})),
  };
}
export function typeName(field) {
  const name = /\s/.test(field.type.type_name) ? quote(field.type.type_name) : field.type.type_name;
  return `${field.type.schemaName ? quote(field.type.schemaName) + '.' : ''}${name}`;
}
export function quote(name) { return '"' + name.replaceAll('"', '""') + '"'; }
export function errorText(error) {
  return error.diags?.map(d => d.message).join('\n') || error.message || String(error);
}
function nextId(map) { return Math.max(0, ...Object.keys(map).map(Number)) + 1; }
function removeRef(model, id) {
  const ref = model.refs[id];
  for (const endpointId of ref.endpointIds) {
    for (const fieldId of model.endpoints[endpointId].fieldIds) {
      const field = model.fields[fieldId];
      if (field) field.endpointIds = field.endpointIds.filter(x => x !== endpointId);
    }
    delete model.endpoints[endpointId];
  }
  const schema = model.schemas[ref.schemaId];
  schema.refIds = schema.refIds.filter(x => x !== id);
  delete model.refs[id];
}
function exportModel(model) {
  const source = ModelExporter.export(model, 'dbml');
  parse(source); // Validate before replacing the last valid schema.
  return source;
}
function assertSafeStructuralEdit(model, table) {
  if (table.checkIds.length || table.recordIds.length || table.fieldIds.some(id => model.fields[id].checkIds.length || model.fields[id].depEdgeIds.length) || table.indexIds.some(id => model.indexes[id].columnIds.some(cid => model.indexColumns[cid].type !== 'column'))) {
    throw new Error('This table has expressions, checks, records or dependencies. Change its structure in the code editor so those expressions can be updated together.');
  }
}
export function saveTable(source, tableId, spec) {
  const model = parse(source).normalize();
  if (!spec.name.trim() || !spec.schema.trim() || !spec.fields.length) throw new Error('Enter a schema, table name, and at least one column.');
  // Parse user-entered types and names through the real DBML grammar.
  let probeName = '__dbx_edit_probe';
  while (Object.values(model.tables).some(t => t.name === probeName)) probeName += '_';
  const probe = parse(source + `\nTable ${quote(spec.schema)}.${quote(probeName)} {\n${spec.fields.map(f => `  ${quote(f.name)} ${f.type} ${f.pk || f.not_null || f.unique ? '[' + [f.pk && 'pk', f.not_null && 'not null', f.unique && 'unique'].filter(Boolean).join(', ') + ']' : ''}`).join('\n')}\n}`).normalize();
  const probeTable = Object.values(probe.tables).find(t => t.name === probeName);
  const parsedFields = probeTable.fieldIds.map(id => probe.fields[id]);
  if (Object.values(probe.tables).length !== Object.values(model.tables).length + 1 || parsedFields.length !== spec.fields.length) throw new Error('Enter a single type for each column.');
  const previous = model.tables[tableId];
  let schema = Object.values(model.schemas).find(s => s.name === spec.schema);
  if (!schema) {
    const id = nextId(model.schemas);
    schema = {...Object.values(probe.schemas).find(s => s.name === spec.schema), id, tableIds: [], enumIds: [], tableGroupIds: [], refIds: [], depIds: [], databaseId: Number(Object.keys(model.database)[0])};
    model.schemas[id] = schema;
    Object.values(model.database)[0].schemaIds.push(id);
  }
  if (Object.values(model.tables).some(t => t.id !== tableId && t.name === spec.name && t.schemaId === schema.id)) throw new Error('A table with that name already exists in this schema.');
  const id = previous?.id ?? nextId(model.tables);
  const table = previous || {...probeTable, id, fieldIds: [], indexIds: [], checkIds: [], recordIds: [], groupId: null};
  const oldFields = [...table.fieldIds];
  const rename = previous && (table.name !== spec.name || table.schemaId !== schema.id || oldFields.some(fid => !spec.fields.some(f => f.id === fid && f.name === model.fields[fid].name)));
  if (rename) assertSafeStructuralEdit(model, table);
  if (previous && table.schemaId !== schema.id) model.schemas[table.schemaId].tableIds = model.schemas[table.schemaId].tableIds.filter(x => x !== id);
  if (!schema.tableIds.includes(id)) schema.tableIds.push(id);
  table.name = spec.name; table.schemaId = schema.id;
  model.tables[id] = table;
  table.fieldIds = spec.fields.map((input, i) => {
    const existing = oldFields.includes(input.id) ? model.fields[input.id] : null;
    const fieldId = existing?.id ?? nextId(model.fields);
    if (existing && existing.name !== input.name) {
      for (const idx of table.indexIds) for (const cid of model.indexes[idx].columnIds) {
        const column = model.indexColumns[cid];
        if (column.type === 'column' && column.value === existing.name) column.value = input.name;
      }
    }
    model.fields[fieldId] = {...(existing || parsedFields[i]), id: fieldId, name: input.name, type: parsedFields[i].type, enumId: parsedFields[i].enumId, pk: !!input.pk, not_null: !!input.not_null, unique: !!input.unique, tableId: id, endpointIds: existing?.endpointIds || [], depEdgeIds: existing?.depEdgeIds || []};
    return fieldId;
  });
  for (const fid of oldFields.filter(fid => !table.fieldIds.includes(fid))) {
    const field = model.fields[fid];
    for (const eid of [...field.endpointIds]) if (model.endpoints[eid]) removeRef(model, model.endpoints[eid].refId);
    for (const iid of [...table.indexIds]) {
      const idx = model.indexes[iid];
      if (idx.columnIds.some(cid => model.indexColumns[cid].value === field.name)) {
        idx.columnIds.forEach(cid => delete model.indexColumns[cid]);
        delete model.indexes[iid]; table.indexIds = table.indexIds.filter(x => x !== iid);
      }
    }
    delete model.fields[fid];
  }
  for (const endpoint of Object.values(model.endpoints)) {
    const field = model.fields[endpoint.fieldIds[0]];
    const target = model.tables[field.tableId];
    endpoint.tableName = target.name;
    endpoint.schemaName = model.schemas[target.schemaId].name;
    endpoint.fieldNames = endpoint.fieldIds.map(fid => model.fields[fid].name);
  }
  return exportModel(model);
}
export function deleteTable(source, tableId) {
  const model = parse(source).normalize();
  const table = model.tables[tableId];
  assertSafeStructuralEdit(model, table);
  for (const ref of Object.values(model.refs)) if (ref.endpointIds.some(eid => model.endpoints[eid].fieldIds.some(fid => table.fieldIds.includes(fid)))) removeRef(model, ref.id);
  for (const iid of table.indexIds) { model.indexes[iid].columnIds.forEach(cid => delete model.indexColumns[cid]); delete model.indexes[iid]; }
  for (const group of Object.values(model.tableGroups)) group.tableIds = group.tableIds.filter(id => id !== tableId);
  table.fieldIds.forEach(fid => delete model.fields[fid]);
  model.schemas[table.schemaId].tableIds = model.schemas[table.schemaId].tableIds.filter(id => id !== tableId);
  delete model.tables[tableId];
  return exportModel(model);
}
export function addRelationship(source, fromId, toId, kind) {
  const model = parse(source).normalize();
  const endpoint = fid => {
    const f = model.fields[fid]; const t = model.tables[f.tableId];
    return `${quote(model.schemas[t.schemaId].name)}.${quote(t.name)}.${quote(f.name)}`;
  };
  if (fromId === toId) throw new Error('Choose two different columns.');
  const next = source + `\nRef: ${endpoint(fromId)} ${kind} ${endpoint(toId)}\n`;
  parse(next);
  return next;
}
export function deleteRelationship(source, id) {
  const model = parse(source).normalize();
  removeRef(model, id);
  return exportModel(model);
}

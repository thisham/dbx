import { SAMPLE, parse, convert, describe, typeName, saveTable, deleteTable, addRelationship, deleteRelationship, saveDependency, deleteDependency, isView, errorText } from './schema.js';
import './app.css';
import { highlightInto } from './highlight.js';
const $ = id => document.getElementById(id);
let source = SAMPLE, language = 'dbml', dialect = 'postgres', filename = 'commerce', view, positions = {}, scale = 1, editingId = null;
let history = [], future = [], dirty = false, drag = null;
const MAX_SIZE = 2 * 1024 * 1024;
let messageTimer, messageRemaining = 0, messageStarted = 0;
function dismissMessage() {
  clearTimeout(messageTimer); messageTimer = null;
  if ($('toast').matches(':popover-open')) $('toast').hidePopover();
}
function resumeMessage() {
  clearTimeout(messageTimer); messageTimer = null;
  if (!$('toast').matches(':popover-open') || $('toast').matches(':hover') || $('toast').contains(document.activeElement)) return;
  messageStarted = Date.now();
  messageTimer = setTimeout(dismissMessage, messageRemaining);
}
function pauseMessage() {
  if (messageTimer) messageRemaining = Math.max(0, messageRemaining - (Date.now() - messageStarted));
  clearTimeout(messageTimer); messageTimer = null;
}
function message(text, error = false) {
  clearTimeout(messageTimer); messageTimer = null;
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
  $('toast').classList.toggle('error-toast', error);
  if (!$('toast').matches(':popover-open')) $('toast').showPopover();
  messageRemaining = error ? 9000 : 5000;
  resumeMessage();
}
$('dismiss-message').onclick = dismissMessage;
$('toast').addEventListener('pointerenter', pauseMessage);
$('toast').addEventListener('pointerleave', resumeMessage);
$('toast').addEventListener('focusin', pauseMessage);
$('toast').addEventListener('focusout', () => setTimeout(resumeMessage, 0));
const fileMenu = $('file-menu');
fileMenu.querySelector('.file-actions').addEventListener('click', event => {
  if (event.target.closest('button')) { fileMenu.open = false; fileMenu.querySelector('summary').focus(); }
});
fileMenu.querySelector('summary').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); fileMenu.open = true; fileMenu.querySelector('button').focus(); }
});
document.addEventListener('click', event => { if (!fileMenu.contains(event.target)) fileMenu.open = false; });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  dismissMessage();
  if (fileMenu.open) { fileMenu.open = false; fileMenu.querySelector('summary').focus(); }
  document.querySelectorAll('.icon-button').forEach(button => button.classList.add('tooltip-dismissed'));
});
document.querySelectorAll('.icon-button').forEach(button => {
  for (const name of ['pointerenter', 'focus']) button.addEventListener(name, () => button.classList.remove('tooltip-dismissed'));
});
function attempt(fn) { try { return fn(); } catch (e) { message(errorText(e), true); return false; } }
function paintCode() { highlightInto($('highlight'), $('code').value, language); $('highlight').scrollTop = $('code').scrollTop; $('highlight').scrollLeft = $('code').scrollLeft; }
$('code').addEventListener('scroll', () => { $('highlight').scrollTop = $('code').scrollTop; $('highlight').scrollLeft = $('code').scrollLeft; });
function setDirty(value) { paintCode(); dirty = value; $('code-state').textContent = value ? 'Unapplied changes' : 'Synced with diagram'; $('apply').disabled = !value; }
function ready() { if (dirty) { message('Apply your code changes before editing the diagram or switching formats.', true); return false; } return true; }
function persist() {
  try { localStorage.setItem('dbx.workspace.v1', JSON.stringify({source, positions, filename, dialect})); }
  catch { message('Browser storage is unavailable. Export your schema to keep a copy.', true); }
}
function key(t) { return JSON.stringify([t.schema, t.name]); }
function snapshot() { return {source, positions: structuredClone(positions), filename}; }
function syncCode() {
  $('code').value = convert(source, 'dbml', language, dialect);
  $('filename').textContent = filename + '.' + language;
  $('dbml-tab').classList.toggle('active', language === 'dbml');
  $('sql-tab').classList.toggle('active', language === 'sql');
  $('undo').disabled = !history.length; $('redo').disabled = !future.length;
  setDirty(false);
}
function commit(next, note = 'Schema updated.', options = {}) {
  const nextView = describe(parse(next));
  // Ensure an SQL view can render before changing any state.
  convert(next, 'dbml', language, dialect);
  history.push(snapshot()); if (history.length > 60) history.shift(); future = [];
  source = next; view = nextView;
  if (options.positions) positions = options.positions;
  if (options.filename) filename = options.filename;
  syncCode(); render(); message(note); persist(); return true;
}
function restore(item) { source = item.source; positions = item.positions; filename = item.filename; view = describe(parse(source)); syncCode(); render(); persist(); }
function element(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
function render() {
  $('tables').replaceChildren();
  $('counts').textContent = `${view.tables.filter(t => !isView(t)).length} tables${view.tables.some(isView) ? ' · ' + view.tables.filter(isView).length + ' views' : ''} · ${view.refs.length} relationships · ${view.lineage.length} dependencies`;
  $('empty').hidden = view.tables.length !== 0;
  view.tables.forEach((table, index) => {
    const position = positions[key(table)] ||= {x: 60 + index % 3 * 330, y: 60 + Math.floor(index / 3) * 320};
    const card = element('article', 'table-card' + (isView(table) ? ' view-card' : '')); card.dataset.id = table.id;
    card.style.left = position.x + 'px'; card.style.top = position.y + 'px';
    const head = element('button', 'table-head');
    head.append(element('span', '', (table.schema === 'public' ? '' : table.schema + '.') + table.name), element('small', '', isView(table) ? 'VIEW ⋮⋮' : '⋮⋮'));
    head.title = 'Drag to move; click to edit ' + table.name;
    head.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      head.setPointerCapture(event.pointerId);
      drag = {id: table.id, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y, moved: false};
    });
    head.addEventListener('pointermove', event => {
      if (!drag || drag.id !== table.id) return;
      const dx = (event.clientX - drag.startX) / scale, dy = (event.clientY - drag.startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      position.x = Math.max(16, drag.x + dx); position.y = Math.max(16, drag.y + dy);
      card.style.left = position.x + 'px'; card.style.top = position.y + 'px'; drawEdges(); resizeCanvas();
    });
    head.addEventListener('pointerup', () => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) persist(); else openTable(table.id); });
    head.addEventListener('pointercancel', () => { drag = null; persist(); });
    head.addEventListener('click', event => { if (event.detail === 0) openTable(table.id); });
    card.append(head);
    table.fields.forEach(field => {
      const row = element('button', 'table-field');
      row.title = `Edit ${field.name}${field.not_null ? ' (not null)' : ''}`;
      row.append(element('span', 'field-key', field.pk ? '◆' : field.endpointIds.length ? '↗' : ''), element('span', 'field-name', field.name), element('span', 'field-type', typeName(field)));
      row.addEventListener('click', () => openTable(table.id)); card.append(row);
    });
    card.append(element('div', 'table-bottom', `${table.fields.length} columns${table.indexIds.length ? ' · ' + table.indexIds.length + ' indexes' : ''}`));
    $('tables').append(card);
  });
  resizeCanvas(); drawEdges();
}
function resizeCanvas() {
  let width = 1000, height = 700;
  for (const t of view.tables) { const p = positions[key(t)]; width = Math.max(width, p.x + 330); height = Math.max(height, p.y + 120 + t.fields.length * 34); }
  $('canvas').style.width = width + 'px'; $('canvas').style.height = height + 'px';
}
function svgElement(tag, attrs, text) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v)); if (text) el.textContent = text; return el; }
function drawEdges() {
  const svg = $('edges'); svg.replaceChildren();
  for (const ref of view.refs) {
    const [a,b] = ref.endpoints, ta = view.tables.find(t => t.id === a.tableId), tb = view.tables.find(t => t.id === b.tableId);
    if (!ta || !tb) continue;
    const pa = positions[key(ta)], pb = positions[key(tb)];
    const right = pa.x <= pb.x;
    const ax = pa.x + (right ? 246 : 0), bx = pb.x + (right ? 0 : 246);
    const ay = pa.y + 47 + ta.fields.findIndex(f => f.id === a.fieldIds[0]) * 34 + 17;
    const by = pb.y + 47 + tb.fields.findIndex(f => f.id === b.fieldIds[0]) * 34 + 17;
    const bend = Math.max(60, Math.abs(bx - ax) * .5);
    const d = ta.id === tb.id ? `M ${pa.x+246} ${ay} C ${pa.x+330} ${ay}, ${pa.x+330} ${by}, ${pa.x+246} ${by}` : `M ${ax} ${ay} C ${ax+(right?bend:-bend)} ${ay}, ${bx+(right?-bend:bend)} ${by}, ${bx} ${by}`;
    const path = svgElement('path', {d, class:'edge', tabindex:'0', role:'button', 'aria-label':`Delete relationship ${ta.name}.${a.fieldNames.join(',')} to ${tb.name}.${b.fieldNames.join(',')}`});
    path.append(svgElement('title', {}, 'Click to remove relationship'));
    const remove = () => { if (ready() && confirm(`Remove relationship between ${ta.name} and ${tb.name}?`)) attempt(() => commit(deleteRelationship(source, ref.id), 'Relationship removed.')); };
    path.addEventListener('click', remove); path.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); remove();} });
    svg.append(path, svgElement('text',{x:ax+(right?9:-18),y:ay-8,class:'edge-label'},a.relation), svgElement('text',{x:bx+(right?-18:9),y:by-8,class:'edge-label'},b.relation));
  }
  drawLineage(svg);
}
function zoom(value) { scale = Math.max(.3, Math.min(1.6, value)); $('canvas').style.zoom = scale; $('zoom').textContent = Math.round(scale * 100) + '%'; }
function fit() {
  if (!view.tables.length) { zoom(1); return; }
  const maxX = Math.max(...view.tables.map(t => positions[key(t)].x + 280));
  const maxY = Math.max(...view.tables.map(t => positions[key(t)].y + 100 + t.fields.length * 34));
  zoom(Math.min(1, $('viewport').clientWidth / maxX, $('viewport').clientHeight / maxY)); $('viewport').scrollTo(0, 0);
}
function columnRow(field = {}) {
  const row = element('div', 'column-row'); row.dataset.id = field.id || '';
  const name = element('input'); name.value = field.name || ''; name.placeholder = 'column_name'; name.required = true; name.setAttribute('aria-label', 'Column name'); name.dataset.prop = 'name';
  const type = element('input'); type.value = field.type ? typeName(field) : 'integer'; type.placeholder = 'varchar(255)'; type.required = true; type.setAttribute('aria-label','Column type'); type.dataset.prop = 'type';
  row.append(name, type);
  for (const prop of ['pk','not_null','unique']) { const input = element('input'); input.type = 'checkbox'; input.checked = !!field[prop]; input.dataset.prop = prop; input.setAttribute('aria-label', ({pk:'Primary key',not_null:'Not null',unique:'Unique'})[prop]); row.append(input); }
  const remove = element('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove column'); remove.onclick = () => row.remove(); row.append(remove); $('column-list').append(row);
}
function openTable(id = null) {
  if (!ready()) return;
  editingId = id;
  const table = view.tables.find(t => t.id === id);
  $('table-kind').value = table && isView(table) ? 'view' : 'table';
  $('view-query').value = table?.metadata?.dbx_query || ''; $('view-dialect').value=table?.metadata?.dbx_dialect || dialect;
  $('view-query-section').hidden = $('table-kind').value !== 'view';
  $('view-dialect').disabled = $('table-kind').value !== 'view';
  $('table-title').textContent = table ? 'Edit table' : 'New table'; $('table-name').value = table?.name || ''; $('table-schema').value = table?.schema || 'public';
  $('table-error').textContent = ''; $('delete-table').hidden = !table; $('column-list').replaceChildren();
  (table?.fields || [{name:'id',type:{type_name:'integer'},pk:true,not_null:true}]).forEach(columnRow);
  $('table-dialog').showModal();
}
$('table-form').onsubmit = event => {
  event.preventDefault();
  try {
    const spec = {kind:$('table-kind').value,query:$('view-query').value.trim(),dialect:$('view-dialect').value,name:$('table-name').value.trim(),schema:$('table-schema').value.trim(),fields:[...$('column-list').children].map(row => {
      const f = {id: Number(row.dataset.id) || null}; row.querySelectorAll('input').forEach(input => f[input.dataset.prop] = input.type === 'checkbox' ? input.checked : input.value.trim()); return f;
    })};
    const nextPositions = structuredClone(positions), old = view.tables.find(t => t.id === editingId);
    if (old) nextPositions[JSON.stringify([spec.schema,spec.name])] = positions[key(old)];
    commit(saveTable(source, editingId, spec), 'Table saved. Code and diagram are in sync.', {positions:nextPositions}); $('table-dialog').close();
  } catch (error) { $('table-error').textContent = errorText(error); }
};
$('delete-table').onclick = () => {
  if (!confirm('Delete this table and its relationships? You can undo this change.')) return;
  if (attempt(() => commit(deleteTable(source, editingId), 'Table deleted.'))) $('table-dialog').close();
};
$('table-kind').onchange=()=>{$('view-query-section').hidden=$('table-kind').value!=='view';$('view-dialect').disabled=$('table-kind').value!=='view';};
$('add-column').onclick = () => columnRow();
$('add-table').onclick = () => openTable();
$('add-ref').onclick = () => {
  if (!ready()) return;
  if (!view.tables.some(t => t.fields.length)) return message('Add columns before connecting tables.', true);
  for (const id of ['ref-from','ref-to']) {
    $(id).replaceChildren();
    view.tables.forEach(t => t.fields.forEach(f => { const option = element('option', '', `${t.schema}.${t.name}.${f.name}`); option.value = f.id; $(id).append(option); }));
  }
  if ($('ref-to').options.length > 1) $('ref-to').selectedIndex = 1;
  $('ref-error').textContent = ''; $('ref-dialog').showModal();
};
$('ref-form').onsubmit = event => {
  event.preventDefault();
  try { commit(addRelationship(source, Number($('ref-from').value), Number($('ref-to').value), $('ref-kind').value), 'Relationship added.'); $('ref-dialog').close(); }
  catch (error) { $('ref-error').textContent = errorText(error); }
};
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('code').oninput = () => setDirty(true);
$('code').onkeydown = event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); $('apply').click(); }
  if (event.key === 'Tab') { event.preventDefault(); const start = event.target.selectionStart, end = event.target.selectionEnd; event.target.setRangeText('  ', start, end, 'end'); setDirty(true); }
};
$('apply').onclick = () => attempt(() => commit(convert($('code').value, language, 'dbml', dialect), 'Code applied. Diagram updated.'));
function switchLanguage(next) { if (!ready()) return; attempt(() => { const text = convert(source, 'dbml', next, dialect); language = next; syncCode(); $('code').value = text; message('Code and diagram are in sync.'); }); }
$('dbml-tab').onclick = () => switchLanguage('dbml'); $('sql-tab').onclick = () => switchLanguage('sql');
$('dialect').onchange = () => {
  const next = $('dialect').value;
  if (!ready()) { $('dialect').value = dialect; return; }
  if (attempt(() => { convert(source,'dbml',language,next); dialect = next; syncCode(); persist(); return true; }) !== true) $('dialect').value = dialect;
};
$('undo').onclick = () => { if (!ready() || !history.length) return; future.push(snapshot()); restore(history.pop()); message('Change undone.'); };
$('redo').onclick = () => { if (!ready() || !future.length) return; history.push(snapshot()); restore(future.pop()); message('Change restored.'); };
$('arrange').onclick = () => { positions = {}; render(); fit(); persist(); };
$('zoom-in').onclick = () => zoom(scale + .1); $('zoom-out').onclick = () => zoom(scale - .1); $('fit').onclick = fit;
$('new').onclick = () => { if (!confirm('Start a new schema? Export first to keep a file copy of this workspace.')) return; attempt(() => commit('', 'New schema ready.', {positions:{},filename:'untitled'})); };
$('import').onclick = () => { if (dirty && !confirm('Discard unapplied code changes and import a file?')) return; $('file').click(); };
$('file').onchange = async () => {
  const file = $('file').files[0]; $('file').value = ''; if (!file) return;
  if (!/\.(dbml|sql)$/i.test(file.name)) return message('Choose a .dbml or .sql file.', true);
  if (file.size > MAX_SIZE) return message('Choose a schema file smaller than 2 MB.', true);
  try {
    const text = await file.text(); const inputLanguage = file.name.toLowerCase().endsWith('.sql') ? 'sql' : 'dbml';
    const next = convert(text, inputLanguage, 'dbml', dialect);
    commit(next, `Imported ${file.name}.`, {positions:{},filename:file.name.replace(/\.(dbml|sql)$/i,'')}); fit();
  } catch (error) { message('Import failed: ' + errorText(error), true); }
};
function download(format) {
  if (!ready()) return;
  attempt(() => {
    const text = convert(source, 'dbml', format, dialect), url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
    const anchor = element('a'); anchor.href = url; anchor.download = filename + '.' + format; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(`Exported ${filename}.${format}${format === 'sql' ? ' (' + $('dialect').selectedOptions[0].textContent + ')' : ''}.`);
  });
}
$('export-dbml').onclick = () => download('dbml'); $('export-sql').onclick = () => download('sql');
window.addEventListener('beforeunload', event => { if (dirty) {event.preventDefault(); event.returnValue = '';} });
try {
  const saved = JSON.parse(localStorage.getItem('dbx.workspace.v1'));
  if (saved && typeof saved.source === 'string') { parse(saved.source); source = saved.source; positions = saved.positions || {}; filename = saved.filename || 'untitled'; dialect = ['postgres','mysql','mssql'].includes(saved.dialect) ? saved.dialect : 'postgres'; }
} catch { message('The saved workspace could not be restored. Showing the example schema.', true); }
$('dialect').value = dialect; view = describe(parse(source)); syncCode(); render(); requestAnimationFrame(fit);

let editingDepId = null;
function drawLineage(svg) {
  const defs = svgElement('defs', {}), marker = svgElement('marker',{id:'lineage-arrow',viewBox:'0 0 10 10',refX:'10',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'});
  marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',class:'lineage-arrow'})); defs.append(marker); svg.append(defs);
  for (const edge of view.lineage) {
    const from = view.tables.find(t=>t.id===edge.upstreamTableId), to = view.tables.find(t=>t.id===edge.downstreamTableId); if (!from || !to) continue;
    const a=positions[key(from)], b=positions[key(to)], right=a.x<=b.x;
    const x1=a.x+(right?246:0), x2=b.x+(right?0:246);
    const y1=a.y+(edge.upstreamFieldIds.length ? 64+from.fields.findIndex(f=>f.id===edge.upstreamFieldIds[0])*34 : 25);
    const y2=b.y+(edge.downstreamFieldIds.length ? 64+to.fields.findIndex(f=>f.id===edge.downstreamFieldIds[0])*34 : 25);
    const bend=Math.max(65,Math.abs(x2-x1)/2);
    const d=from.id===to.id ? `M ${a.x+246} ${y1} C ${a.x+335} ${y1-45}, ${a.x+335} ${y2+45}, ${a.x+246} ${y2}` : `M ${x1} ${y1} C ${x1+(right?bend:-bend)} ${y1}, ${x2+(right?-bend:bend)} ${y2}, ${x2} ${y2}`;
    const path=svgElement('path',{d,class:'edge lineage','marker-end':'url(#lineage-arrow)',tabindex:'0',role:'button','aria-label':`Edit lineage ${from.name} to ${to.name}`});
    if (/^#[\da-f]{3,8}$/i.test(edge.dependency.color || '')) path.style.stroke=edge.dependency.color;
    path.append(svgElement('title',{},[edge.dependency.name,`${from.name} → ${to.name}`,edge.dependency.note].filter(Boolean).join('\n')));
    path.onclick=()=>openDependency(edge.id); path.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDependency(edge.id);}}; svg.append(path);
  }
}
function openDependency(id=null) {
  if (!ready()) return;
  if (!view.tables.length) return message('Add tables before creating lineage.',true);
  editingDepId=id; const edge=view.lineage.find(e=>e.id===id);
  for (const side of ['from','to']) {
    const select=$('dep-'+side); select.replaceChildren();
    for (const table of view.tables) {
      const tableOption=element('option','',`${table.schema}.${table.name} (whole table)`); tableOption.value=JSON.stringify({tableId:table.id,fieldIds:[]}); select.append(tableOption);
      for (const field of table.fields) { const option=element('option','',`${table.schema}.${table.name}.${field.name}`);option.value=JSON.stringify({tableId:table.id,fieldIds:[field.id]});select.append(option); }
    }
    if (edge) {
      const prefix=side==='from'?'upstream':'downstream', value=JSON.stringify({tableId:edge[prefix+'TableId'],fieldIds:edge[prefix+'FieldIds']});
      if (![...select.options].some(o=>o.value===value)) {const option=element('option','',edge[prefix].tableName+'.('+edge[prefix].fieldNames.join(', ')+')');option.value=value;select.append(option);}
      select.value=value;
    }
  }
  if (!edge && view.tables.length>1) $('dep-to').value=JSON.stringify({tableId:view.tables[1].id,fieldIds:[]});
  $('dep-title').textContent=edge?'Edit dependency':'New dependency';$('dep-note').value=edge?.dependency.note||'';
  $('dep-details').textContent=edge ? [edge.dependency.name,...Object.entries(edge.dependency.metadata||{}).map(([k,v])=>`${k}: ${v}`)].filter(Boolean).join(' · ') : 'The arrow points from source data to the derived table or column.';
  $('dep-error').textContent='';$('delete-dep').hidden=!edge;$('dep-dialog').showModal();
}
$('add-dep').onclick=()=>openDependency();
$('dep-form').onsubmit=e=>{e.preventDefault();try{commit(saveDependency(source,editingDepId,JSON.parse($('dep-from').value),JSON.parse($('dep-to').value),$('dep-note').value),'Data lineage updated.');$('dep-dialog').close();}catch(error){$('dep-error').textContent=errorText(error);}};
$('delete-dep').onclick=()=>{if(attempt(()=>commit(deleteDependency(source,editingDepId),'Dependency removed.'))) $('dep-dialog').close();};

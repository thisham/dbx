// A lossless lexer for the editor overlay: source text is always inserted as text nodes.
const dbml = new Set('table viewtable tablepartial tablegroup diagramview tables notes tablegroups schemas enum ref dep project note indexes checks records metadata pk primary key not null unique increment default delete update cascade restrict set no action color headercolor query owner materialized true false'.split(' '));
const sql = new Set('select from where join left right inner outer full on as create alter drop table view materialized or replace if exists not null primary key foreign references constraint unique check default insert into values update delete set and or distinct group by order having union all with recursive case when then else end asc desc limit offset true false is in index schema database begin commit'.split(' '));
const types = new Set('int integer bigint smallint serial bigserial varchar nvarchar char text boolean bool decimal numeric float double real date datetime timestamp timestamptz time uuid json jsonb bytea blob money'.split(' '));
export function tokenize(source, language = 'dbml') {
  const tokens = [], pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|--[^\n]*|'''[\s\S]*?(?:'''|$)|'(?:\\[\s\S]|''|[^'\\])*(?:'|$)|"(?:\\[\s\S]|""|[^"\\])*(?:"|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w$]*|<-|->|<>|[{}\[\]():,.<>~=+-]/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > offset) tokens.push({text:source.slice(offset,match.index),kind:''});
    const text = match[0], lower = text.toLowerCase(); let kind = '';
    if (text.startsWith('//') || text.startsWith('/*') || (language === 'sql' && text.startsWith('--'))) kind = 'comment';
    else if (/^['`]/.test(text)) kind = 'string';
    else if (text.startsWith('"')) kind = 'identifier';
    else if (/^\d/.test(text)) kind = 'number';
    else if ((language === 'sql' ? sql : dbml).has(lower)) kind = 'keyword';
    else if (types.has(lower)) kind = 'type';
    else if (/^[{}\[\]():,.<>~=+\-]/.test(text)) kind = 'punctuation';
    tokens.push({text,kind}); offset = match.index + text.length;
  }
  if (offset < source.length) tokens.push({text:source.slice(offset),kind:''});
  return tokens;
}
export function highlightInto(target, source, language) {
  const nodes = tokenize(source, language).map(({text,kind}) => {
    if (!kind) return document.createTextNode(text);
    const span = document.createElement('span'); span.className = 'syntax-' + kind; span.textContent = text; return span;
  });
  target.replaceChildren(...nodes, document.createTextNode('\n'));
}

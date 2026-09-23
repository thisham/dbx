import { test, expect } from '@playwright/test';

test('schema editing, validation, history and local restore', async ({page}) => {
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('.table-card')).toHaveCount(4);
 await page.locator('#code').fill('Table invalid {'); await page.locator('#apply').click();
 await expect(page.locator('#message')).toHaveClass('error');
 await expect(page.locator('.table-card')).toHaveCount(4);
 await page.locator('#code').fill('Table users {\n id int [pk]\n email varchar(255)\n}'); await page.locator('#apply').click();
 await expect(page.locator('.table-card')).toHaveCount(1);
 await page.locator('.table-head').click();
 await expect(page.locator('#table-dialog')).toBeVisible();
 await page.locator('#table-name').fill('people'); await page.getByRole('button',{name:'Save table'}).click();
 await expect(page.locator('.table-head')).toContainText('people');
 await expect(page.locator('#code')).toHaveValue(/Table "people"/);
 await page.locator('#undo').click(); await expect(page.locator('.table-head')).toContainText('users');
 await page.locator('#redo').click(); await expect(page.locator('.table-head')).toContainText('people');
 await page.reload(); await expect(page.locator('.table-head')).toContainText('people');
 await page.locator('#sql-tab').click(); await expect(page.locator('#code')).toHaveValue(/CREATE TABLE/);
 expect(errors).toEqual([]);
});

test('SQL file import, DBML and SQL export, visual relationship creation', async ({page}) => {
 await page.goto('/');
 await page.locator('#file').setInputFiles({name:'example.sql',mimeType:'text/plain',buffer:Buffer.from('CREATE TABLE accounts (id integer PRIMARY KEY); CREATE TABLE entries (id integer PRIMARY KEY, account_id integer);')});
 await expect(page.locator('.table-card')).toHaveCount(2);
 await page.locator('#add-ref').click();
 await page.locator('#ref-from').selectOption({label:'public.entries.account_id'}); await page.locator('#ref-to').selectOption({label:'public.accounts.id'});
 await page.locator('#ref-form').getByRole('button',{name:'Add relationship',exact:true}).click(); await expect(page.locator('.edge')).toHaveCount(1);
 for (const format of ['dbml','sql']) {
  const promise=page.waitForEvent('download'); await page.locator('#file-menu summary').click(); await page.locator('#export-'+format).click(); const download=await promise;
  expect(download.suggestedFilename()).toBe('example.'+format);
  const stream=await download.createReadStream(); const chunks=[]; for await(const c of stream) chunks.push(c); const content=Buffer.concat(chunks).toString();
  expect(content).toContain(format==='dbml' ? 'Ref:' : 'FOREIGN KEY');
 }
});

test('new table and column workflow, dragging, deletion and invalid import', async ({page}) => {
 await page.goto('/'); page.on('dialog', d=>d.accept());
 await page.locator('#file-menu summary').click(); await page.locator('#new').click(); await expect(page.locator('.table-card')).toHaveCount(0);
 await page.locator('#add-table').click(); await page.locator('#table-name').fill('events');
 await page.locator('#add-column').click();
 await page.getByRole('textbox',{name:'Column name',exact:true}).nth(1).fill('title');
 await page.getByRole('textbox',{name:'Column type',exact:true}).nth(1).fill('varchar(120)');
 await page.getByRole('button',{name:'Save table'}).click(); await expect(page.locator('.table-card')).toHaveCount(1);
 const header=page.locator('.table-head'), box=await header.boundingBox();
 await page.mouse.move(box.x+30,box.y+20); await page.mouse.down(); await page.mouse.move(box.x+130,box.y+80,{steps:5}); await page.mouse.up();
 const moved=await header.boundingBox(); expect(moved.x).toBeGreaterThan(box.x+50);
 await page.locator('#file').setInputFiles({name:'broken.dbml',mimeType:'text/plain',buffer:Buffer.from('Table broken {')});
 await expect(page.locator('#message')).toHaveClass('error'); await expect(page.locator('.table-card')).toHaveCount(1);
 await header.click(); await page.locator('#delete-table').click(); await expect(page.locator('.table-card')).toHaveCount(0);
});

test('DBML and SQL code are highlighted without interpreting source as HTML', async ({page}) => {
 await page.goto('/');
 await expect(page.locator('#highlight .syntax-keyword').first()).toHaveText('Table');
 await page.locator('#code').fill("// <img src=x onerror=alert(1)>\nTable sample {\n id int [pk]\n}");
 await expect(page.locator('#highlight .syntax-comment')).toContainText('<img');
 await expect(page.locator('#highlight img')).toHaveCount(0);
 await page.locator('#apply').click();await page.locator('#sql-tab').click();
 await expect(page.locator('#highlight .syntax-keyword').first()).toHaveText('CREATE');
});

test('import SQL views, edit queries and inspect directional lineage', async ({page}) => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('#file').setInputFiles({name:'views.sql',mimeType:'text/plain',buffer:Buffer.from('CREATE TABLE orders (id int, amount decimal(10,2)); CREATE VIEW report AS SELECT id, amount FROM orders;')});
 await expect(page.locator('.view-card')).toHaveCount(1);
 await expect(page.locator('.view-card .table-head')).toContainText('VIEW');
 await expect(page.locator('.lineage')).toHaveCount(1);
 await expect(page.locator('.lineage')).toHaveAttribute('marker-end','url(#lineage-arrow)');
 await page.locator('.view-card .table-head').click();
 await expect(page.locator('#view-query')).toHaveValue('SELECT id, amount FROM orders');
 await page.locator('#view-query').fill('SELECT id, amount FROM orders WHERE amount > 0');
 await page.getByRole('button',{name:'Save table'}).click();
 const download=page.waitForEvent('download');await page.locator('#file-menu summary').click(); await page.locator('#export-sql').click();
 const stream=await (await download).createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);const sql=Buffer.concat(chunks).toString();
 expect(sql).toContain('CREATE VIEW');expect(sql).toContain('WHERE amount > 0');expect(sql).not.toContain('CREATE TABLE "report"');
 await page.locator('.lineage').focus();await page.keyboard.press('Enter');await expect(page.locator('#dep-dialog')).toBeVisible();
 await page.locator('#dep-note').fill('Report sourced from orders');await page.getByRole('button',{name:'Save dependency'}).click();
 await expect(page.locator('#code')).toHaveValue(/Report sourced from orders/);
 await page.locator('#add-dep').click();await page.locator('#dep-from').selectOption({label:'public.orders.id'});await page.locator('#dep-to').selectOption({label:'public.report.id'});await page.getByRole('button',{name:'Save dependency'}).click();
 await expect(page.locator('.lineage')).toHaveCount(2);
 await page.reload();await expect(page.locator('.view-card')).toHaveCount(1);await expect(page.locator('.lineage')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('create a SQL view visually and preserve it through history', async ({page}) => {
 await page.goto('/');await page.locator('#add-table').click();await page.locator('#table-kind').selectOption('view');await page.locator('#table-name').fill('customer_ids');await page.locator('#view-query').fill('SELECT id FROM customers');await page.getByRole('button',{name:'Save table'}).click();
 await expect(page.locator('.view-card')).toHaveCount(1);await expect(page.locator('#code')).toHaveValue(/dbx_kind: 'view'/);
 await page.locator('#undo').click();await expect(page.locator('.view-card')).toHaveCount(0);await page.locator('#redo').click();await expect(page.locator('.view-card')).toHaveCount(1);
 await page.locator('#sql-tab').click();await expect(page.locator('#code')).toHaveValue(/CREATE VIEW "customer_ids"/);
});

test('compact file menu and bottom icon tools expose tooltips and keep statistics visible', async ({page}) => {
 await page.goto('/');
 await expect(page.locator('#new')).not.toBeVisible();
 await page.locator('#file-menu summary').click();
 for(const id of ['new','import','export-dbml','export-sql']) await expect(page.locator('#'+id)).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#new')).not.toBeVisible();
 const nav=page.getByRole('navigation',{name:'Diagram tools'});
 for(const label of ['Arrange tables','Add table','Add relationship','Add lineage','Zoom out','Zoom in','Fit diagram']) {
  const tool=nav.getByRole('button',{name:label,exact:true});await tool.hover();await expect(tool.getByRole('tooltip')).toHaveText(label);await expect(tool.getByRole('tooltip')).toBeVisible();
 }
 await page.keyboard.press('Escape');await expect(page.locator('#fit-tip')).not.toBeVisible();
 await expect(nav.locator('#counts')).toContainText('4 tables');
 const before=await page.locator('#zoom').textContent();await page.locator('#zoom-in').click();expect(await page.locator('#zoom').textContent()).not.toBe(before);
 await page.setViewportSize({width:375,height:812});
 await expect(nav).toBeVisible();await expect(nav.locator('#counts')).toBeVisible();await expect(page.locator('#viewport')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
 const bounds=await nav.boundingBox();expect(bounds.y+bounds.height).toBeLessThanOrEqual(813);
});

test('floating notifications expire, pause for reading and dismiss manually', async ({page}) => {
 await page.goto('/');await page.clock.install();
 await page.locator('#code').fill('Table sample {\n id int\n}');await page.locator('#apply').click();
 await expect(page.locator('#toast')).toBeVisible();await expect(page.locator('#message')).toContainText('Code applied');
 await page.clock.runFor(5100);await expect(page.locator('#toast')).not.toBeVisible();
 await page.locator('#code').fill('Table broken {');await page.locator('#apply').click();
 await expect(page.locator('#toast')).toBeVisible();await expect(page.locator('#message')).toHaveClass('error');
 await page.locator('#toast').hover();await page.clock.runFor(10000);await expect(page.locator('#toast')).toBeVisible();
 await page.locator('#apply').hover();await page.clock.runFor(9100);await expect(page.locator('#toast')).not.toBeVisible();
 await page.locator('#apply').click();await page.locator('#dismiss-message').click();await expect(page.locator('#toast')).not.toBeVisible();
});

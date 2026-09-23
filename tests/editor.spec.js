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
 await page.getByRole('button',{name:'Add relationship',exact:true}).click(); await expect(page.locator('.edge')).toHaveCount(1);
 for (const format of ['dbml','sql']) {
  const promise=page.waitForEvent('download'); await page.locator('#export-'+format).click(); const download=await promise;
  expect(download.suggestedFilename()).toBe('example.'+format);
  const stream=await download.createReadStream(); const chunks=[]; for await(const c of stream) chunks.push(c); const content=Buffer.concat(chunks).toString();
  expect(content).toContain(format==='dbml' ? 'Ref:' : 'FOREIGN KEY');
 }
});

test('new table and column workflow, dragging, deletion and invalid import', async ({page}) => {
 await page.goto('/'); page.on('dialog', d=>d.accept());
 await page.locator('#new').click(); await expect(page.locator('.table-card')).toHaveCount(0);
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

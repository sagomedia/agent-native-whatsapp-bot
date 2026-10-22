// Shared browser helpers for the responsive owner tools dialog.
export async function setOwnerLanguage(page,locale){
 const picker=page.getByLabel('Dashboard language / மொழி',{exact:true});
 const mobile=await page.locator('.owner-tools-trigger').isVisible();
 if(mobile&&!await picker.isVisible())await page.locator('.owner-tools-trigger').click();
 await picker.selectOption(locale);
 if(mobile)await page.keyboard.press('Escape');
}
export async function openOwnerHelp(page){
 if(await page.locator('.owner-tools-trigger').isVisible())await page.locator('.owner-tools-trigger').click();
 await page.getByRole('button',{name:'Quick help',exact:true}).click();
}

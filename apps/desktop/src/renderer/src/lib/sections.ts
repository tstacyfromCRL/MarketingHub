/** The top bar is Home, Calendar, Tasks, Studio, and Knowledge. The other work screens hang off Studio, and Brand hangs off that. Knowledge is its own item so it does not open the Studio rows. */

const STUDIO = ['/studio', '/campaigns', '/approvals', '/library', '/brand-kit', '/products', '/analytics', '/content', '/designs', '/posts'];
const BRAND = ['/brand-kit', '/products', '/analytics'];
const CONTENT = ['/studio', '/content', '/designs', '/posts'];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const isStudioPath = (pathname: string) => matches(pathname, STUDIO);
export const isBrandPath = (pathname: string) => matches(pathname, BRAND);
export const isContentPath = (pathname: string) => matches(pathname, CONTENT);
export const isCampaignsPath = (pathname: string) => matches(pathname, ['/campaigns']);
export const isApprovalsPath = (pathname: string) => matches(pathname, ['/approvals']);
export const isLibraryPath = (pathname: string) => matches(pathname, ['/library']);

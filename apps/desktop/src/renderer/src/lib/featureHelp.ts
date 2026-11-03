export interface FeatureHelp {
  title: string;
  /** What this screen is for. */
  purpose: string;
  /** How a person uses it. */
  how: string;
  /** Why it is worth having. */
  why: string;
}

interface Topic {
  /** Most specific topics are listed first. The first match wins. */
  test: (path: string) => boolean;
  help: FeatureHelp;
}

const home: FeatureHelp = {
  title: 'Home',
  purpose: 'Home is your starting point after you sign in. It shows what is waiting on you.',
  how: 'Look at posts that need you, your tasks, and what is coming up. Open any item to work on it. The box at the bottom of the screen can start a draft or a task from a sentence. A banner here also brings you back to company setup if that is unfinished.',
  why: 'You can see the work that needs a person before you go looking through the other screens.',
};

const calendar: FeatureHelp = {
  title: 'Calendar',
  purpose: 'The calendar shows when posts go out and when the team has events.',
  how: 'Move through the month. Add a team event on a day. Open a scheduled post from the day it will publish.',
  why: 'Publishing dates and the team’s own dates sit together, so planning does not depend on a separate calendar.',
};

const tasks: FeatureHelp = {
  title: 'Tasks',
  purpose: 'Tasks are the marketing work that is not itself a post.',
  how: 'Cards move through Backlog, To Do, In Progress, Review, and Done. Drag a card, or use the icons on it to move it forward, edit it, archive it, or delete it. Archive hides a task without deleting it. Turn on Archived to see those tasks and restore one. Delete asks you to confirm first.',
  why: 'The team can see who is doing what, and paused work is still there when you need it.',
};

const studio: FeatureHelp = {
  title: 'Content',
  purpose: 'Content is where you draft one post, email, blog, or documentation page.',
  how: 'On Social post, describe the idea, then Write with AI for a tagline, sub-tagline, and post copy you can edit. Choose a library photo and a Canva brand template. Create draft & edit in Canva fills the photo plus the first two text fields and opens Canva to refine. Click Return in Canva and the post preview updates to that finished graphic. Approve the draft; a manager schedules it. On Graphics, New from Canva works the same for standalone designs. Emails, blogs, and docs still start from a brief on their own tab.',
  why: 'The draft starts from your brand and knowledge base, and the graphic is finished in Canva before it is scheduled.',
};

const post: FeatureHelp = {
  title: 'Post',
  purpose: 'This is one post, from the first draft through publishing.',
  how: 'Edit the words and check the warnings. Attach or open the graphic. Move the post through approval. A manager can send it back with a note. After approval it can be scheduled. Nothing posts until a manager has approved it.',
  why: 'This is the record of what will actually go out, and who still needs to say yes.',
};

const contentDoc: FeatureHelp = {
  title: 'Long-form draft',
  purpose: 'This is a longer piece, such as an email, a blog, or a documentation page.',
  how: 'Edit the title and the body, then save. You can ask for a revision from here and copy or download the text.',
  why: 'Longer writing stays with the same company knowledge as a social post, and you can keep revising it.',
};

const design: FeatureHelp = {
  title: 'Design editor',
  purpose: 'The design editor is where you build the picture that goes with a post.',
  how: 'Set the canvas size. Add text, shapes, or a logo. Place a photo from the library, or open a file with Use in New Design. Save the graphic onto the post, or export it.',
  why: 'The picture uses the brand colors and fonts, and it stays attached to the words.',
};

const campaigns: FeatureHelp = {
  title: 'Campaigns',
  purpose: 'A campaign is a set of posts planned across a range of dates.',
  how: 'Create a campaign, choose the dates and the products, and let Mantis propose the posts and graphics. Open the campaign to review each post before it goes to approval.',
  why: 'A week or a month of content is easier to plan as one set than as many separate posts.',
};

const approvals: FeatureHelp = {
  title: 'Approvals',
  purpose: 'Approvals is the queue of posts that are waiting for a person.',
  how: 'A creator approves their own draft first. A manager then reviews it, edits it, approves it, or sends it back with a note. Approved posts can be scheduled. A failed publish can be tried again.',
  why: 'Nothing is published until a person has checked it.',
};

const library: FeatureHelp = {
  title: 'Library',
  purpose: 'The library is the photos and files the team is allowed to use, plus uploads from the connected Canva account.',
  how: 'Shared drive holds the indexed Marketing & Media files. An admin sets that location once. Import the folders or files you want. Tag a file, assign a product, or mark it Not for public use so the AI skips it. The file stays visible to people, just grayed out. Select an image and choose Use in New Design to place it on a new graphic. The Canva tab browses folders and uploaded images from the connected Canva account. Canva does not list videos here yet. A manager connects Canva under Settings → Social accounts.',
  why: 'Drive files stay on the shared share, and Canva uploads are reachable without leaving Mantis.',
};

const brandKit: FeatureHelp = {
  title: 'Brand kit',
  purpose: 'The brand kit holds the logos, colors, fonts, and visual identity.',
  how: 'Add logo files, backgrounds, and patterns or overlays. Enter the brand colors and set the fonts. In the graphics editor, use Background, Overlay, Logo, and Image to place the ones you want. Export downloads a zip of the saved kit, including the company profile. Import replaces the kit on this computer. Example post pictures are not in the file.',
  why: 'You pick the pieces of each graphic instead of asking the generator to invent the layout.',
};

const products: FeatureHelp = {
  title: 'Products',
  purpose: 'Products are what Mantis may mention in writing and recognize in photos.',
  how: 'Add a product with its part numbers, price, what it does, and how it is used. Upload a manual or add a link to documentation. Add competitor and partner websites and social pages when you want the AI to learn the market. Confirm which library photos show the product.',
  why: 'Drafts stay specific to what you sell, and the right photos get suggested. Competitor and partner pages are labeled so they are not written as your own claims.',
};

const analytics: FeatureHelp = {
  title: 'Analytics',
  purpose: 'Analytics shows how posts and tasks are moving.',
  how: 'Look at how many posts were created and published, how they break down by status and platform, and how long manager review is taking.',
  why: 'You can see a backup in review, or a quiet week, without reading every post.',
};

const knowledgeBrand: FeatureHelp = {
  title: 'Brand profile',
  purpose: 'The brand profile is who the company is, in words the AI uses every time.',
  how: 'Fill in the company name, summary, audience, voice, and the always and never lists. Under How posts should look, describe the appearance and drop pictures of past posts. Save when the words are done. The pictures save as you add them.',
  why: 'The voice is added to every draft. The appearance text leads new graphics, including their colors when it names a 60-30-10 theme. Example pictures set the frame: photo, banner, accent, and logo. Facts come from the other knowledge tabs.',
};

const playbooks: FeatureHelp = {
  title: 'Playbooks',
  purpose: 'A playbook is the writing instruction for a kind of piece. It is not a fact about a product.',
  how: 'Edit the instructions, and optionally the platform, content type, pillar, hashtag range, and length. The box at the top shows which playbook a draft would pick. The closest match wins: a LinkedIn social post beats a generic social post.',
  why: 'A LinkedIn post and a blog should not be written the same way. The playbook shapes the draft. Approved claims and product facts still supply the numbers and the details.',
};

const claims: FeatureHelp = {
  title: 'Claims',
  purpose: 'Claims are the numbers and results the company is willing to say in public.',
  how: 'Add the claim, where it came from, and when it expires. It has to be approved before a draft may rely on it.',
  why: 'If a draft uses a number that is not in an approved claim or the company knowledge, you get a warning before it goes out.',
};

const confidential: FeatureHelp = {
  title: 'Confidential',
  purpose: 'Confidential is the list of names that must not appear in a draft.',
  how: 'Add the name, any other ways it is written, and a note if you need one.',
  why: 'A draft is checked against this list, and a warning tells the writer to take the name out.',
};

const catalog: FeatureHelp = {
  title: 'Products in the knowledge base',
  purpose: 'This is the same product list the AI writes from, edited here in the knowledge base.',
  how: 'Add or edit a product. Set part numbers and a price. Describe what it does and how it is used. Upload documentation or paste links to it. Add competitor and partner websites and social pages. A manager can also sync or import a catalog.',
  why: 'The writer can only be specific about products you have described. Outside companies are kept labeled as market context.',
};

const integrations: FeatureHelp = {
  title: 'Integrations',
  purpose: 'Integrations bring products in from another system.',
  how: 'A manager turns on a connector, such as Shopify or a CSV file, saves the connection, and syncs.',
  why: 'You do not have to retype a catalog that already lives somewhere else. Notes you added yourself, such as how a product is used, stay put when a sync runs.',
};

const documents: FeatureHelp = {
  title: 'Documents',
  purpose: 'Documents are reference files for the whole company, not for one product.',
  how: 'Upload a Markdown, text, PDF, or Word file. Choose whether it is public, internal, or restricted.',
  why: 'The AI can read manuals and notes you already have. Restricted files are never used in a draft. Internal files are left out when a cloud model is writing.',
};

const sources: FeatureHelp = {
  title: 'Links and examples',
  purpose: 'This is where you add pages to learn from, and past posts that show your voice.',
  how: 'Add a web page and Mantis reads it. For a sample post, paste the text yourself. Sample posts are used as tone. They are not treated as facts.',
  why: 'Drafts can sound like your past writing, and they can stay current with pages you trust.',
};

const accomplishments: FeatureHelp = {
  title: 'Accomplishments',
  purpose: 'Accomplishments are real results and milestones.',
  how: 'Add a title, the date, and a short description of what happened.',
  why: 'The AI can mention work the company has actually done, instead of inventing a story.',
};

const pack: FeatureHelp = {
  title: 'Import / Export',
  purpose: 'Import and export move the knowledge base as one pack.',
  how: 'Export writes the current knowledge out. Import reads a pack back in. You can preview an import before it changes anything.',
  why: 'The company knowledge can be backed up or loaded without editing every tab by hand.',
};

const retrieval: FeatureHelp = {
  title: 'What the AI knows',
  purpose: 'This shows which saved passages would be found for a question.',
  how: 'Type a question the way you might brief a post. Read the passages that come back.',
  why: 'If a draft misses something obvious, you can see whether that fact is actually in the knowledge base.',
};

const search: FeatureHelp = {
  title: 'Search',
  purpose: 'Search finds something already saved in Mantis.',
  how: 'Results can include posts, tasks, products, library files, and knowledge.',
  why: 'You do not have to remember which screen holds it.',
};

const settingsGeneral: FeatureHelp = {
  title: 'My settings',
  purpose: 'My settings is your own account, not the whole company.',
  how: 'Choose in-app, email, or Slack notifications. An admin also sets the shared drive the library uses. Each computer finds that same drive on its own.',
  why: 'You hear about reviews and tasks the way you want, and the library points at the real shared drive.',
};

const settingsSocial: FeatureHelp = {
  title: 'Social accounts',
  purpose: 'Social accounts are the connections used to publish.',
  how: 'A manager connects each network the team posts to. Until an account is connected, a post can be approved and scheduled, but it will not go out. Canva is connected on this same screen. The server needs the Canva app id and secret first.',
  why: 'Publishing stays tied to the company’s own accounts, and only a manager sets that up.',
};

const settingsTeam: FeatureHelp = {
  title: 'Team',
  purpose: 'Team is where an admin adds people and chooses what they can do.',
  how: 'Invite someone and give them a role. A creator drafts and sends work for approval. A manager can also review, approve, and return work. An admin can also manage the team, the library drive, and system settings.',
  why: 'People only see the actions their role allows, and new teammates can join with an invite.',
};

const settingsLog: FeatureHelp = {
  title: 'Work log',
  purpose: 'The work log is a history of important actions.',
  how: 'Read the list from newest to oldest. It records things like edits, approvals, uploads, and publishes, and who did them.',
  why: 'When something changed, you can see who did it and when, without asking around.',
};

const settingsSystem: FeatureHelp = {
  title: 'System',
  purpose: 'System is the admin view of how Mantis is running.',
  how: 'Check whether the AI is reachable. After the AI model changes, re-index the knowledge base from here so search uses the new model.',
  why: 'Drafts and search only work well when the AI is up and the knowledge index matches it.',
};

const onboarding: FeatureHelp = {
  title: 'Company setup',
  purpose: 'Company setup teaches Mantis who you are the first time.',
  how: 'Walk through the company name, a short description, logos, colors, and voice. You can leave and come back. The banner on Home returns you here.',
  why: 'Drafts sound like the company only after this is filled in.',
};

const login: FeatureHelp = {
  title: 'Sign in',
  purpose: 'This screen is how you enter Mantis.',
  how: 'Sign in with your email and password. A new teammate uses an invite code. On a brand-new server, the first person creates the company. If Mantis cannot reach the server, open Connection settings and check the address.',
  why: 'Your work and the company knowledge stay with your account, on the server your team shares.',
};

const fallback: FeatureHelp = {
  title: 'Mantis',
  purpose: 'Mantis is where the marketing team keeps the brand, files, and publishing together.',
  how: 'Use the top bar for Home, Calendar, Tasks, Studio, and Knowledge. The gear opens Settings. The question mark explains the screen you are on.',
  why: 'Drafts, files, and approvals stay in one place instead of being scattered across other tools.',
};

const TOPICS: Topic[] = [
  { test: (path) => path === '/', help: home },
  { test: (path) => path === '/login' || path.startsWith('/login/'), help: login },
  { test: (path) => path === '/onboarding' || path.startsWith('/onboarding/'), help: onboarding },
  { test: (path) => path === '/calendar' || path.startsWith('/calendar/'), help: calendar },
  { test: (path) => path === '/tasks' || path.startsWith('/tasks/'), help: tasks },
  { test: (path) => path === '/designs' || path.startsWith('/designs/'), help: design },
  { test: (path) => path === '/posts' || path.startsWith('/posts/'), help: post },
  { test: (path) => path === '/content' || path.startsWith('/content/'), help: contentDoc },
  { test: (path) => path === '/studio' || path.startsWith('/studio/'), help: studio },
  { test: (path) => path === '/campaigns' || path.startsWith('/campaigns/'), help: campaigns },
  { test: (path) => path === '/approvals' || path.startsWith('/approvals/'), help: approvals },
  { test: (path) => path === '/library' || path.startsWith('/library/'), help: library },
  { test: (path) => path === '/brand-kit' || path.startsWith('/brand-kit/'), help: brandKit },
  { test: (path) => path === '/products' || path.startsWith('/products/'), help: products },
  { test: (path) => path === '/analytics' || path.startsWith('/analytics/'), help: analytics },
  { test: (path) => path === '/knowledge/playbooks' || path.startsWith('/knowledge/playbooks/'), help: playbooks },
  { test: (path) => path === '/knowledge/claims' || path.startsWith('/knowledge/claims/'), help: claims },
  { test: (path) => path === '/knowledge/confidential' || path.startsWith('/knowledge/confidential/'), help: confidential },
  { test: (path) => path === '/knowledge/catalog' || path.startsWith('/knowledge/catalog/'), help: catalog },
  { test: (path) => path === '/knowledge/integrations' || path.startsWith('/knowledge/integrations/'), help: integrations },
  { test: (path) => path === '/knowledge/documents' || path.startsWith('/knowledge/documents/'), help: documents },
  { test: (path) => path === '/knowledge/sources' || path.startsWith('/knowledge/sources/'), help: sources },
  { test: (path) => path === '/knowledge/accomplishments' || path.startsWith('/knowledge/accomplishments/'), help: accomplishments },
  { test: (path) => path === '/knowledge/pack' || path.startsWith('/knowledge/pack/'), help: pack },
  { test: (path) => path === '/knowledge/search' || path.startsWith('/knowledge/search/'), help: retrieval },
  { test: (path) => path === '/knowledge' || path.startsWith('/knowledge/'), help: knowledgeBrand },
  { test: (path) => path === '/settings/social' || path.startsWith('/settings/social/'), help: settingsSocial },
  { test: (path) => path === '/settings/users' || path.startsWith('/settings/users/'), help: settingsTeam },
  { test: (path) => path === '/settings/log' || path.startsWith('/settings/log/'), help: settingsLog },
  { test: (path) => path === '/settings/system' || path.startsWith('/settings/system/'), help: settingsSystem },
  { test: (path) => path === '/settings' || path.startsWith('/settings/'), help: settingsGeneral },
  { test: (path) => path === '/search' || path.startsWith('/search/'), help: search },
];

/** The explanation for the screen at this path. A deeper path beats the section it sits in. */
export function helpForPath(pathname: string): FeatureHelp {
  return TOPICS.find((topic) => topic.test(pathname))?.help ?? fallback;
}

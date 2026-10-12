const { q } = require('./db');
const { importRecords } = require('./jobs');

// Clearly fictional sample listings so the design isn't empty before real jobs are loaded.
function seedDemo() {
  if (q.get('SELECT COUNT(*) n FROM jobs').n > 0) return 0;
  const soon = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const note = '\n\nThis is a SAMPLE listing for design preview. Delete all sample data under Admin → Settings before launch.';
  const rows = [
    { title: 'Vice President of Regional Economic Strategy', organization: 'Sample Valley Economic Partnership', location: 'Springfield, VA', salary: '$145,000 - $165,000', category: 'Economic Development', work_mode: 'Hybrid', closes: soon(11), featured: 'yes', description: 'Lead a regional business-attraction and retention program.\n\n- Manage a team of five\n- Steward the regional site portfolio\n- Report to the CEO' + note },
    { title: 'President & Chief Executive Officer', organization: 'Sample Harbor Regional Chamber of Commerce', location: 'Bellingham, WA', salary: '$120,000 - $140,000', category: 'Chambers of Commerce', work_mode: 'On-site', closes: soon(18), featured: 'yes', description: 'Chief executive for a 900-member regional chamber.' + note },
    { title: 'Senior Program Officer, Place Initiatives', organization: 'Sample Prairie Community Foundation', location: 'Des Moines, IA', salary: '$95,000 - $115,000', category: 'Community Foundations', work_mode: 'Hybrid', closes: soon(6), description: 'Direct neighborhood-revitalization grantmaking.' + note },
    { title: 'Director of Downtown Development', organization: 'Sample River City Development Company', location: 'Chattanooga, TN', salary: '$105,000 - $125,000', category: 'Place-Based Leadership', work_mode: 'On-site', closes: soon(14), description: 'Run downtown improvement programs and public-realm projects.' + note },
    { title: 'Director of Lending', organization: 'Sample Main Street Capital Fund', location: 'Columbus, OH', salary: '$110,000 - $130,000', category: 'CDFIs & Community Capital', work_mode: 'Hybrid', closes: soon(25), description: 'Lead small-business and real-estate lending for a community development financial institution.' + note },
    { title: 'Associate Director, Civic Engagement', organization: 'Sample State University Civic Institute', location: 'Raleigh, NC', salary: '$78,000 - $92,000', category: 'Higher Ed Civic Practice', work_mode: 'Hybrid', closes: soon(30), description: 'Coordinate university-community partnerships.' + note },
    { title: 'Membership & Business Development Director', organization: 'Sample Harbor Regional Chamber of Commerce', location: 'Bellingham, WA', salary: '$72,000 - $85,000', category: 'Chambers of Commerce', work_mode: 'On-site', closes: soon(21), description: 'Grow and retain chamber membership.' + note },
    { title: 'Workforce & Talent Programs Manager', organization: 'Sample Valley Economic Partnership', location: 'Remote', salary: '$82,000 - $98,000', category: 'Economic Development', work_mode: 'Remote', closes: soon(40), description: 'Build employer-led talent pipelines.' + note },
  ];
  const r = importRecords(rows, { source: 'demo', kind: 'seed', autoPublish: true });
  q.run("UPDATE organizations SET source = 'demo', description = 'Sample organization for design preview.' WHERE name LIKE 'Sample %'");
  return r.added;
}

function clearDemo() {
  const j = q.run("DELETE FROM jobs WHERE source = 'demo'").changes;
  q.run("DELETE FROM organizations WHERE source = 'demo' AND id NOT IN (SELECT org_id FROM jobs WHERE org_id IS NOT NULL)");
  return j;
}
const hasDemo = () => q.get("SELECT COUNT(*) n FROM jobs WHERE source = 'demo'").n > 0;

module.exports = { seedDemo, clearDemo, hasDemo };

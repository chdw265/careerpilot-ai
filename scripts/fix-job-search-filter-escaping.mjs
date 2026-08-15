import fs from 'node:fs';

const path = 'index.html';
let source = fs.readFileSync(path, 'utf8');

const helperMarker = '    async function searchJobs() {';
const helper = `    function quotePostgrestFilterValue(value) {
      return \`"\${String(value || "")
        .replace(/\\\\/g, "\\\\\\\\")
        .replace(/"/g, '\\\\"')}"\`;
    }

`;

if (!source.includes('function quotePostgrestFilterValue(value)')) {
  if (!source.includes(helperMarker)) throw new Error('searchJobs marker not found');
  source = source.replace(helperMarker, helper + helperMarker);
}

const oldKeyword = `      if (keyword) {
        query = query.or(\`title.ilike.%\${keyword}%,description.ilike.%\${keyword}%,company_name.ilike.%\${keyword}%\`);
      }`;
const newKeyword = `      if (keyword) {
        const keywordPattern = quotePostgrestFilterValue(\`*\${keyword}*\`);
        query = query.or(
          \`title.ilike.\${keywordPattern},description.ilike.\${keywordPattern},company_name.ilike.\${keywordPattern}\`
        );
      }`;

if (source.includes(oldKeyword)) {
  source = source.replace(oldKeyword, newKeyword);
} else if (!source.includes('const keywordPattern = quotePostgrestFilterValue')) {
  throw new Error('keyword filter marker not found');
}

fs.writeFileSync(path, source);

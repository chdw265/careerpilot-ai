from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = root / "index.html"
html = path.read_text()
style = (root / "scripts/search-coverage-style.block.css.txt").read_text().rstrip()
runtime = (root / "scripts/search-coverage-runtime.block.js.txt").read_text().rstrip()

def replace_once(label, before, after):
    global html
    count = html.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    html = html.replace(before, after, 1)

replace_once("style", "    .job-card {", style + "\n\n    .job-card {")
replace_once(
    "coverage host",
    '      <p id="jobSearchStatus">Loading current jobs...</p>\n      <div id="jobResults"></div>',
    '      <p id="jobSearchStatus">Loading current jobs...</p>\n      <div id="jobCoverageNotice" class="employer-coverage-notice" aria-live="polite"></div>\n      <div id="jobResults"></div>',
)
replace_once(
    "state",
    '    let currentApplicationRouteOfficialLocation = null;\n    const CAREERPILOT_QUICK_APPLY_PROVIDERS',
    '    let currentApplicationRouteOfficialLocation = null;\n    let employerCoverageCache = new Map();\n    let canonicalEmployerNameByAlias = new Map();\n    let employerCoverageLookupUnavailable = false;\n    const CAREERPILOT_QUICK_APPLY_PROVIDERS',
)
replace_once(
    "runtime",
    '    function setMessage(element, message, type) {',
    runtime + '\n\n    function setMessage(element, message, type) {',
)
replace_once(
    "company link",
    '      button.textContent = companyName || "Company not listed";',
    '      button.textContent = canonicalEmployerNameFor(companyName);',
)
replace_once(
    "company display",
    '      currentCompanyName = companyName;\n      companySection.style.display = "block";\n      document.getElementById("companyPageName").textContent = companyName;',
    '      currentCompanyName = companyName;\n      const displayCompanyName = canonicalEmployerNameFor(companyName);\n      companySection.style.display = "block";\n      document.getElementById("companyPageName").textContent = displayCompanyName;',
)
replace_once(
    "company search label",
    '      searchButton.textContent = `Search all ${companyName} jobs`;\n      searchButton.addEventListener("click", () => {\n        document.getElementById("jobCompany").value = companyName;',
    '      searchButton.textContent = `Search all ${displayCompanyName} jobs`;\n      searchButton.addEventListener("click", () => {\n        document.getElementById("jobCompany").value = displayCompanyName;',
)
replace_once(
    "empty state",
    '''      if (!jobs.length) {
        const message = document.createElement("p");
        message.textContent = "No jobs matched your search.";
        results.appendChild(message);
        return;
      }''',
    '''      if (!jobs.length) {
        if (!options.suppressEmpty) {
          const message = document.createElement("p");
          message.textContent = options.emptyMessage || "No jobs matched your search.";
          results.appendChild(message);
        }
        return;
      }''',
)
replace_once(
    "search setup",
    '''      const status = document.getElementById("jobSearchStatus");
      const results = document.getElementById("jobResults");

      status.textContent = "Searching current jobs...";
      results.innerHTML = "";

      const signedIn = Boolean(currentSession?.user);''',
    '''      const status = document.getElementById("jobSearchStatus");
      const results = document.getElementById("jobResults");
      const coverageNotice = document.getElementById("jobCoverageNotice");

      status.textContent = "Searching current jobs...";
      results.innerHTML = "";
      coverageNotice.innerHTML = "";

      const coverageRows = company ? await resolveEmployerCoverage(company, 8) : [];
      const companyTerms = employerSearchTerms(company, coverageRows);
      const signedIn = Boolean(currentSession?.user);''',
)
replace_once(
    "company filter",
    '      if (company) query = query.ilike("company_name", `%${company}%`);',
    '''      if (company) {
        query = coverageRows.length && companyTerms.length
          ? query.in("company_name", companyTerms)
          : query.ilike("company_name", `%${company}%`);
      }''',
)
replace_once(
    "render coverage",
    '''      renderJobs(jobs, results, { matchMap, fitMap });
      syncSaveButtons();
    }

    async function getSuggestions(databaseField, searchText) {''',
    '''      renderJobs(jobs, results, {
        matchMap,
        fitMap,
        suppressEmpty: Boolean(company),
      });
      if (!jobs.length && company) {
        renderEmployerCoverageNotice({ company, keyword, location, coverageRows });
      }
      syncSaveButtons();
    }

    async function getSuggestions(databaseField, searchText) {''',
)
replace_once(
    "autocomplete setup",
    '''      if (term.length < 2) return [];

      const { data, error } = await db''',
    '''      if (term.length < 2) return [];

      const coverageRows = databaseField === "company_name"
        ? await resolveEmployerCoverage(searchText, 8)
        : [];
      const { data, error } = await db''',
)
replace_once(
    "autocomplete result",
    '''      if (error) {
        console.error("Autocomplete error:", error);
        return [];
      }

      const uniqueValues = [...new Set((data || []).map(row => row[databaseField]).filter(Boolean))];''',
    '''      if (error) {
        console.error("Autocomplete error:", error);
      }

      const coverageNames = coverageRows.map(row => row.canonical_name).filter(Boolean);
      const databaseValues = (data || []).map(row => row[databaseField]).filter(Boolean);
      const uniqueValues = [...new Set([...coverageNames, ...databaseValues])];''',
)

path.write_text(html)
print("Applied search coverage repair")

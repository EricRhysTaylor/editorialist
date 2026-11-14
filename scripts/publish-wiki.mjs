
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WIKI_REPO = 'git@github.com:EricRhysTaylor/editorialist.wiki.git';
const TEMP_DIR = '.wiki_temp_publish';
const SOURCE_DIR = 'wiki';
// docs.radialtimeline.com/editorialist/ is built from the published wiki by this workflow.
const DOCS_REPO = 'EricRhysTaylor/radial-timeline-docs';
const DOCS_WORKFLOW = 'deploy.yml';

function run(command, cwd) {
    console.log(`> ${command}`);
    try {
        execSync(command, { stdio: 'inherit', cwd });
    } catch (e) {
        console.error(`Command failed: ${command}`);
        process.exit(1);
    }
}

// Start a redeploy of the docs site so it picks up the pages just pushed. Best effort: a
// missing or logged-out gh, or a refused dispatch, only prints the command to run by hand;
// the wiki itself is already published.
function redeployDocs() {
    const command = `gh workflow run ${DOCS_WORKFLOW} -R ${DOCS_REPO}`;
    try {
        execSync(command, { stdio: 'pipe' });
        console.log(`📚 Docs site redeploy started: https://github.com/${DOCS_REPO}/actions`);
    } catch {
        console.warn(`⚠️  Could not start the docs site redeploy. Run it by hand: ${command}`);
    }
}

function publish() {
    console.log('🚀 Starting Wiki Publish...');

    // 1. Clean up previous temp dir
    if (fs.existsSync(TEMP_DIR)) {
        console.log('Cleaning up previous temp directory...');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }

    // 2. Clone the Wiki repo
    console.log(`Cloning ${WIKI_REPO}...`);
    try {
        execSync(`git clone ${WIKI_REPO} ${TEMP_DIR}`, { stdio: 'inherit' });
    } catch (e) {
        console.error('Could not clone the wiki repo.');
        console.error('This publisher uses the same GitHub SSH authentication as the main repository.');
        console.error('If GitHub reports "Repository not found", initialize the wiki once before publishing:');
        console.error('  open https://github.com/EricRhysTaylor/editorialist/wiki and click "Create the first page",');
        console.error('  save the placeholder, then re-run npm run publish-wiki (it will overwrite the placeholder).');
        process.exit(1);
    }

    // 3. Copy files from 'wiki/' to temp dir
    console.log(`Copying files from ${SOURCE_DIR} to ${TEMP_DIR}...`);
    // Using cp -R for simplicity on Mac
    run(`cp -R ${SOURCE_DIR}/. ${TEMP_DIR}/`);
    // Strip macOS metadata files so they never reach the public wiki
    run(`find ${TEMP_DIR} -name .DS_Store -delete`);

    // 4. Commit and Push
    console.log('Committing and pushing changes...');
    const cwd = path.resolve(TEMP_DIR);

    // Check for changes
    try {
        const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
        if (!status) {
            console.log('✅ No changes to publish.');
        } else {
            // Build a descriptive commit message from the changed files
            const changedFiles = status.split('\n').filter(Boolean).map(l => l.slice(3).trim());
            const pad = (n) => String(n).padStart(2, '0');
            const now = new Date();
            const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            const summary = changedFiles.slice(0, 6).map(f => f.replace(/\.md$/, '')).join(', ');
            const extra = changedFiles.length > 6 ? ` (+${changedFiles.length - 6} more)` : '';
            const commitMsg = `[wiki] ${ts} — ${changedFiles.length} pages — ${summary}${extra}`;

            run('git add .', cwd);
            run(`git commit -m ${JSON.stringify(commitMsg)}`, cwd);
            run('git push', cwd);
            console.log('✅ Wiki published successfully!');
            redeployDocs();
        }
    } catch (e) {
        console.error('Error checking git status or pushing');
    }

    // 5. Cleanup
    console.log('Cleaning up...');
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('Done.');
}

publish();

import PocketBase from 'pocketbase';

const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQaktKL9GNnSxsKVdAZchbrRItir0R6PYO5pQdWmP6qmlq-aRNLRHt_-bO1OFIi_f-1pS81Uj3P_UZF/pub?output=csv';
const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables.');
    process.exit(1);
}

const pb = new PocketBase(PB_URL);

const parseCsv = (csvText) => {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // Basic CSV parsing logic matching the original app
    const dealers = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = line.split(',');
        if (values.length < 3) continue;

        const id = values[0]?.trim();
        const logo = values[values.length - 1]?.trim();
        const name = values.slice(1, values.length - 1).join(',').trim();
        
        if (id && name) {
            dealers.push({
                id,
                name,
                logo: logo || undefined,
            });
        }
    }
    return dealers;
};

async function migrate() {
    try {
        console.log(`Connecting to ${PB_URL}...`);
        await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        console.log('Authenticated.');

        console.log('Fetching CSV data...');
        const response = await fetch(GOOGLE_SHEET_URL);
        const csvText = await response.text();

        const dealers = parseCsv(csvText);
        console.log(`Found ${dealers.length} dealers to migrate.`);

        // Check if collection exists, create if not
        try {
            await pb.collections.getOne('dealers');
            console.log("'dealers' collection exists.");
        } catch (err) {
            console.log("'dealers' collection not found. Creating...");
            await pb.collections.create({
                name: 'dealers',
                type: 'base',
                schema: [
                    {
                        name: 'name',
                        type: 'text',
                        required: true,
                    },
                    {
                        name: 'logo',
                        type: 'text',
                    }
                ]
            });
            console.log("'dealers' collection created.");
        }

        for (const dealer of dealers) {
            try {
                // Check if a dealer with this name already exists to avoid duplicates
                const safeName = dealer.name.split('"').join('\"');
                const existing = await pb.collection('dealers').getList(1, 1, { 
                    filter: `name = "${safeName}"` 
                });
                
                if (existing.totalItems > 0) {
                    console.log(`Skipping ${dealer.name} (already exists)`);
                    continue;
                }

                await pb.collection('dealers').create({
                    name: dealer.name,
                    logo: dealer.logo,
                });
                console.log(`Migrated: ${dealer.name}`);
            } catch (err) {
                // Log error safely
                const msg = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
                console.error(`Failed to migrate ${dealer.name}:`, msg);
            }
        }

        console.log('Migration complete!');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

migrate();

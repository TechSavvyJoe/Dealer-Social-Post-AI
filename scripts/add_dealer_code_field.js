import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables.');
    process.exit(1);
}

const pb = new PocketBase(PB_URL);

async function addDealerCodeField() {
    try {
        console.log(`Connecting to ${PB_URL}...`);
        await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        console.log('✅ Authenticated.');

        const collection = await pb.collections.getOne('dealers');
        console.log("✅ Found 'dealers' collection.");

        // Check if code field already exists
        const hasCodeField = collection.schema.some(field => field.name === 'code');

        if (hasCodeField) {
            console.log("ℹ️  'code' field already exists.");
        } else {
            console.log("📝 Adding 'code' field...");
            
            // Add the new code field
            collection.schema.push({
                name: 'code',
                type: 'text',
                required: true,
                options: {
                    min: 4,
                    max: 4,
                    pattern: '^[0-9]{4}$'
                }
            });

            await pb.collections.update(collection.id, collection);
            console.log("✅ 'code' field added successfully!");
        }

        // Update API rules to allow public read access (needed for login)
        console.log("📝 Updating API rules for public read access...");
        
        await pb.collections.update(collection.id, {
            listRule: "",  // Allow anyone to list dealers (for login)
            viewRule: "",  // Allow anyone to view a specific dealer (for login)
            createRule: null,  // Nobody can create via API (admin only)
            updateRule: null,  // Nobody can update via API (admin only)
            deleteRule: null,  // Nobody can delete via API (admin only)
        });

        console.log("✅ API rules updated - public read access enabled!");
        
        // Now let's check existing dealers and suggest adding codes
        console.log("\n📊 Checking existing dealers...");
        const dealers = await pb.collection('dealers').getFullList();
        
        console.log(`Found ${dealers.length} dealer(s):`);
        dealers.forEach((dealer, index) => {
            console.log(`  - ${dealer.name} (ID: ${dealer.id}, Code: ${dealer.code || 'NOT SET'})`);
        });

        if (dealers.some(d => !d.code)) {
            console.log("\n⚠️  Some dealers don't have codes set.");
            console.log("💡 You can set codes via the PocketBase admin UI or run the populate script.");
        }

    } catch (err) {
        console.error('❌ Failed:', err);
        if (err.response) {
            console.error('Response data:', err.response);
        }
    }
}

addDealerCodeField();

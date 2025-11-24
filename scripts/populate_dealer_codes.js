import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables.');
    process.exit(1);
}

const pb = new PocketBase(PB_URL);

async function populateDealerCodes() {
    try {
        console.log(`Connecting to ${PB_URL}...`);
        await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        console.log('✅ Authenticated.');

        // Get all dealers
        const dealers = await pb.collection('dealers').getFullList();
        console.log(`\n📊 Found ${dealers.length} dealer(s).\n`);

        if (dealers.length === 0) {
            console.log('⚠️  No dealers found. Please add dealers first.');
            return;
        }

        // Assign codes 0000, 1111, 2222, etc. to dealers that don't have codes
        let codeCounter = 0;
        
        for (const dealer of dealers) {
            if (dealer.code) {
                console.log(`✓ ${dealer.name} already has code: ${dealer.code}`);
            } else {
                // Generate a 4-digit code (0000, 1111, 2222, ...)
                const newCode = String(codeCounter).repeat(4).slice(0, 4).padStart(4, '0');
                
                // Update the dealer with the new code
                await pb.collection('dealers').update(dealer.id, {
                    code: newCode
                });
                
                console.log(`✅ Assigned code ${newCode} to ${dealer.name}`);
                codeCounter++;
            }
        }

        console.log('\n🎉 Done! All dealers now have codes.');
        console.log('\n📝 Current dealers:');
        
        // Show final list
        const updatedDealers = await pb.collection('dealers').getFullList({ sort: 'code' });
        updatedDealers.forEach(dealer => {
            console.log(`  - Code ${dealer.code}: ${dealer.name}`);
        });

    } catch (err) {
        console.error('❌ Failed:', err);
        if (err.response) {
            console.error('Response data:', err.response);
        }
    }
}

populateDealerCodes();

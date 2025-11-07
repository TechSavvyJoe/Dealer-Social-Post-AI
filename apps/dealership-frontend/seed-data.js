// Script to seed initial data into PocketBase
// Run with: node seed-data.js

const PocketBase = require('pocketbase');

const pb = new PocketBase('https://even-terry-exactly-unique.trycloudflare.com');

async function seedData() {
  try {
    // Login as admin
    console.log('Logging in as manager...');
    // You'll need to update these credentials
    const authData = await pb.collection('users').authWithPassword(
      'manager@dealership.com', // Replace with your manager email
      'password123' // Replace with your manager password
    );
    
    console.log('Logged in successfully');
    
    // Check if salespeople exist
    const existingSalespeople = await pb.collection('salespeople').getFullList();
    
    if (existingSalespeople.length === 0) {
      console.log('No salespeople found. Creating sample salespeople...');
      
      // Create sample salespeople
      const salesperson1 = await pb.collection('salespeople').create({
        name: 'John Smith',
        user_id: authData.record.id, // Using manager's user_id as placeholder
        performance_metrics: {
          total_sales: 0,
          average_score: 0,
          success_rate: 0
        }
      });
      
      const salesperson2 = await pb.collection('salespeople').create({
        name: 'Sarah Johnson',
        user_id: authData.record.id,
        performance_metrics: {
          total_sales: 0,
          average_score: 0,
          success_rate: 0
        }
      });
      
      console.log('Created salespeople:', salesperson1.name, salesperson2.name);
      
      // Create sample sales
      console.log('Creating sample sales...');
      
      await pb.collection('sales').create({
        salesperson_id: salesperson1.id,
        customer_name: 'Mike Anderson',
        success_probability: 85,
        transcript: {
          segments: [
            { speaker: 'Salesperson', text: 'Good morning! Welcome to our dealership.' },
            { speaker: 'Customer', text: 'Hi, I\'m looking for a new SUV.' },
          ]
        },
        analysis: {
          sentiment: 'positive',
          key_points: ['Customer interested in SUV', 'Budget flexible']
        },
        performance_report: {
          overall_score: 85,
          strengths: ['Good rapport building', 'Clear communication'],
          improvements: ['Ask more qualifying questions']
        }
      });
      
      await pb.collection('sales').create({
        salesperson_id: salesperson2.id,
        customer_name: 'Lisa Chen',
        success_probability: 72,
        transcript: {
          segments: [
            { speaker: 'Salesperson', text: 'How can I help you today?' },
            { speaker: 'Customer', text: 'I need a reliable sedan.' },
          ]
        },
        analysis: {
          sentiment: 'neutral',
          key_points: ['Looking for reliability', 'Price conscious']
        },
        performance_report: {
          overall_score: 72,
          strengths: ['Knowledgeable about products'],
          improvements: ['Build more enthusiasm']
        }
      });
      
      console.log('✅ Sample data created successfully!');
    } else {
      console.log(`Found ${existingSalespeople.length} existing salespeople. Skipping seed.`);
    }
    
  } catch (error) {
    console.error('Error seeding data:', error);
    if (error.response) {
      console.error('Response:', error.response);
    }
  }
}

seedData();

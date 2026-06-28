const cron = require('node-cron');
const axios = require('axios');

// Run on 1st of every month at 00:01
cron.schedule('1 0 1 * *', async () => {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        
        console.log(`Running auto-billing for ${year}-${month}`);
        
        await axios.post('http://localhost:5003/api/bills/auto-generate', {
            year, month
        }, {
            headers: { 'Authorization': `Bearer ${process.env.CRON_TOKEN}` }
        });
        
        console.log('Auto-billing completed');
    } catch (error) {
        console.error('Auto-billing failed:', error.message);
    }
});
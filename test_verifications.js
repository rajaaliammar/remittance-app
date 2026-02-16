import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const BASE_URL = (process.env.EXTERNAL_API_URL || 'https://apibrandpay.appliedline.com').replace(/\/+$/, '') + '/api';

async function testVerifications() {
    try {
        console.log('=== Testing Verifications Endpoint ===\n');

        // Step 1: Login as "test test" user
        console.log('Step 1: Logging in as test test (phone: 2519876)...');
        const loginResponse = await axios.post(`${BASE_URL}/accounts/login-pin/`, {
            phone: '2519876',
            pin: '1234' // Assuming default PIN
        });

        if (!loginResponse.data.success) {
            console.error('❌ Login failed:', loginResponse.data);
            return;
        }

        const token = loginResponse.data.data.token;
        const userId = loginResponse.data.data.customer?.id;
        console.log('✅ Login successful');
        console.log('User ID:', userId);
        console.log('Token:', token.substring(0, 20) + '...\n');

        // Step 2: Call verifications endpoint
        console.log('Step 2: Fetching verifications...');
        const verificationsResponse = await axios.get(`${BASE_URL}/accounts/verifications/`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('✅ Verifications response:');
        console.log(JSON.stringify(verificationsResponse.data, null, 2));
        console.log('\n=== Check backend logs for detailed debug info ===');

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testVerifications();

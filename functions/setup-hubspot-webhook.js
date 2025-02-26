const axios = require('axios');

const privateAppToken = 'pat-eu1-cdd36ab0-067e-445f-bc9d-7fe61d7c21c9'; 
const appId = '8648799'; // Your App ID
const webhookUrl = 'https://crm-superbase.netlify.app/.netlify/functions/hubspot-webhook';

const subscriptionPayload = {
  subscriptionDetails: {
    subscriptionType: 'engagement.created',
    propertyName: 'engagement.type',
    condition: {
      equals: 'EMAIL'
    }
  },
  enabled: true,
  webhookUrl: webhookUrl
};

async function createWebhookSubscription() {
  try {
    const response = await axios.post(
      `https://api.hubapi.com/webhooks/v1/${appId}/subscriptions`,
      subscriptionPayload,
      {
        headers: {
          'Authorization': `Bearer ${privateAppToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Webhook subscription created successfully!');
    console.log('Subscription ID:', response.data.subscriptionId);
    console.log('Details:', response.data);
  } catch (error) {
    console.error('Error creating webhook subscription:');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.response?.data?.message || error.message);
  }
}

createWebhookSubscription();

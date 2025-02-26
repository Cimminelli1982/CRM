const axios = require('axios');

const privateAppToken = '3eda2c14-0d71-4423-b1e4-ef0b4843393c'; // Fake token, replace with real
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

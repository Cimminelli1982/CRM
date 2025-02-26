const fetch = require('node-fetch');
const Airtable = require('airtable');

// Initialize Airtable
const base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base('appTMYAU4N43eJdxG');
const interactionsTable = base('tblXub1Mg6RtXScPG');

// Enhanced logging function
function logError(context, error, additionalData = {}) {
  console.error({
    timestamp: new Date().toISOString(),
    context: context,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    additionalData
  });
}

// Format phone number to match Airtable format
function formatPhoneNumber(phone) {
  if (!phone) return null;
  // Remove any non-digit characters
  const digits = phone.replace(/\D/g, '');
  // Always add + prefix if not present
  return digits.startsWith('+') ? digits : `+${digits}`;
}

// Format timestamp for Airtable Date field
function formatTimestamp(timestamp) {
  // Parse the input timestamp
  const date = new Date(timestamp);
  // Return just the date part in YYYY-MM-DD format
  return date.toISOString().split('T')[0];
}

// Parse incoming WhatsApp event from TimelinesAI
function parseWhatsAppEvent(eventData) {
  console.log('Received webhook payload:', JSON.stringify(eventData, null, 2));
  
  try {
    // Check if this is a group chat - if yes, return empty array to skip processing
    if (eventData.chat && eventData.chat.is_group === true) {
      console.log('Skipping group chat message');
      return [];
    }
    
    if (eventData.message) {
      // Single message format
      console.log('Processing single message format (one-to-one chat)');
      return [{
        phoneNumber: eventData.chat.phone,
        timestamp: eventData.message.timestamp,
        direction: eventData.message.direction,
        text: eventData.message.text,
        messageId: eventData.message.message_uid
      }];
    }
    
    throw new Error('Invalid webhook format received');
  } catch (error) {
    logError('parseWhatsAppEvent', error, { eventData });
    throw error;
  }
}

// Validate phone number
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    console.warn('Phone number is empty or undefined');
    return false;
  }
  
  // Remove any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  // Check if we have at least a reasonable number of digits for an international number
  const isValid = cleaned.length >= 10;
  
  if (!isValid) {
    console.warn(`Invalid phone number format: ${phoneNumber}`);
  } else {
    console.log(`Valid phone number: ${phoneNumber}`);
  }
  
  return isValid;
}

// Netlify function handler
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const messages = parseWhatsAppEvent(body);
    
    // If no messages to process (e.g., because it was a group chat), just return success
    if (messages.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'No individual chat messages to process' })
      };
    }
    
    for (const messageData of messages) {
      const { phoneNumber, timestamp, direction, text } = messageData;
      
      if (!isValidPhoneNumber(phoneNumber)) {
        continue;
      }

      // Format the timestamp for Airtable
      const formattedDate = formatTimestamp(timestamp);
      
      // Create a minimal record with just the fields we're confident about
      const interactionData = {
        'Interaction Date': formattedDate,
        'Contact Mobile': formatPhoneNumber(phoneNumber),
        'Direction': direction === 'sent' ? 'Outbound' : 'Inbound',
        'Notes': text || ''
      };
      
      // Try to add Interaction type if configured correctly
      try {
        // First try with lowercase 't'
        interactionData['Interaction type'] = 'WhatsApp';
        
        console.log('Creating interaction with data:', interactionData);
        await interactionsTable.create(interactionData);
        console.log('Successfully created interaction record');
      } catch (error) {
        // If that fails, try with uppercase 'T'
        if (error.message.includes('Unknown field name: "Interaction type"')) {
          delete interactionData['Interaction type'];
          interactionData['Interaction Type'] = 'WhatsApp';
          
          try {
            console.log('Retrying with uppercase T:', interactionData);
            await interactionsTable.create(interactionData);
            console.log('Successfully created interaction record with uppercase T');
          } catch (retryError) {
            // If both fail, try without the field at all
            if (retryError.message.includes('Unknown field name')) {
              delete interactionData['Interaction Type'];
              
              try {
                console.log('Retrying without interaction type field:', interactionData);
                await interactionsTable.create(interactionData);
                console.log('Successfully created minimal interaction record');
              } catch (finalError) {
                logError('finalCreateAttempt', finalError, { interactionData });
                throw finalError;
              }
            } else {
              throw retryError;
            }
          }
        } else {
          throw error;
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    logError('webhookHandler', error, { eventBody: event.body });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

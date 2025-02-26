const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

// Format phone number to consistent format
function formatPhoneNumber(phone) {
  if (!phone) return null;
  // Remove any non-digit characters except plus sign
  const cleaned = phone.replace(/[^\d+]/g, '');
  // Always add + prefix if not present
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// Format timestamp for database Date field
function formatTimestamp(timestamp) {
  // Parse the input timestamp
  const date = new Date(timestamp);
  // Return ISO date string (YYYY-MM-DD)
  return date.toISOString().split('T')[0];
}

// Find contact by phone number in Supabase
async function findContactByPhone(phoneNumber) {
  console.log('Looking up contact with phone number:', phoneNumber);
  
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    // Query the Contacts table
    const { data, error } = await supabase
      .from('Contacts')
      .select('*')
      .eq('mobile', formattedPhone)
      .limit(1);
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      console.log(`Found contact: ${data[0].first_name || ''} ${data[0].last_name || ''}`);
      return data[0];
    }
    
    console.log('No matching contact found');
    return null;
  } catch (error) {
    logError('findContactByPhone', error, { phoneNumber });
    console.log('Error looking up contact:', error.message);
    return null;
  }
}

// Create a new contact in Supabase
async function createContact(phoneNumber, name = null) {
  console.log('Creating new contact for phone number:', phoneNumber);
  
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    // Try to extract first name and last name if a full name is provided
    let firstName = null;
    let lastName = null;
    
    if (name) {
      const nameParts = name.split(' ');
      if (nameParts.length > 1) {
        firstName = nameParts[0];
        lastName = nameParts.slice(1).join(' ');
      } else {
        firstName = name;
      }
    }
    
    // Prepare the contact data
    const contactData = {
      mobile: formattedPhone,
      first_name: firstName,
      last_name: lastName,
      contact_category: null, // You can add logic to set this if needed
      email: null // You can add logic to set this if needed
    };
    
    // Insert the new contact
    const { data, error } = await supabase
      .from('Contacts')
      .insert([contactData])
      .select();
    
    if (error) throw error;
    
    console.log('Contact created successfully:', data[0].id);
    return data[0];
  } catch (error) {
    logError('createContact', error, { phoneNumber, name });
    console.log('Error creating contact:', error.message);
    return null;
  }
}

// Create a new interaction record
async function createInteraction(data) {
  console.log('Creating interaction:', data);
  
  try {
    const { data: result, error } = await supabase
      .from('Interactions')
      .insert([data]);
    
    if (error) throw error;
    
    console.log('Interaction created successfully');
    return result;
  } catch (error) {
    logError('createInteraction', error, { data });
    throw error;
  }
}

// Parse incoming WhatsApp event from TimelinesAI
function parseWhatsAppEvent(eventData) {
  console.log('Received webhook payload:', JSON.stringify(eventData, null, 2));
  
  try {
    // Check if this is a group chat - if yes, skip
    if (eventData.chat && eventData.chat.is_group === true) {
      console.log('Skipping group chat message');
      return [];
    }
    
    // Check if phone number exists
    if (!eventData.chat || !eventData.chat.phone) {
      console.log('Message without valid phone number, skipping');
      return [];
    }
    
    if (eventData.message) {
      // Single message format
      console.log('Processing single message format (one-to-one chat)');
      return [{
        phoneNumber: eventData.chat.phone,
        senderName: eventData.chat.full_name,
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
      const { phoneNumber, senderName, timestamp, direction, text } = messageData;
      
      if (!isValidPhoneNumber(phoneNumber)) {
        continue;
      }

      // Format the timestamp for the database
      const formattedDate = formatTimestamp(timestamp);
      
      // Look up contact by phone number
      let contact = await findContactByPhone(phoneNumber);
      
      // If no contact found, create a new one
      if (!contact) {
        contact = await createContact(phoneNumber, senderName);
        console.log('Created new contact record from WhatsApp interaction');
      }
      
      // Create the interaction data
      const interactionData = {
        iteration_date: formattedDate,
        Interaction_type: 'WhatsApp',
        Contact_mobile: formatPhoneNumber(phoneNumber),
        Contact_email: contact ? contact.email : null,
        Direction: direction === 'sent' ? 'Outbound' : 'Inbound',
        Note: text || '',
        contact_id: contact ? contact.id : null
      };
      
      // Create the interaction record
      await createInteraction(interactionData);
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

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
    context,
    error: {
      message: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      name: error?.name || 'UnknownError'
    },
    additionalData
  });
}

// Format phone number to a consistent format
function formatPhoneNumber(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, ''); // Remove non-numeric characters except '+'
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// Format timestamp to 'YYYY, MONTH DD'
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: '2-digit'
  });
}

// Find contact by phone number in Supabase
async function findContactByPhone(phoneNumber) {
  console.log('Looking up contact with phone number:', phoneNumber);

  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('mobile', formattedPhone)
      .limit(1);

    if (error) throw error;

    return data.length > 0 ? data[0] : null;
  } catch (error) {
    logError('findContactByPhone', error, { phoneNumber });
    return null;
  }
}

// Create a new contact in Supabase
async function createContact(phoneNumber, name = null) {
  console.log('Creating new contact for phone number:', phoneNumber);

  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    let firstName = null;
    let lastName = null;

    if (name) {
      const nameParts = name.split(' ');
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ') || null;
    }

    const contactData = {
      mobile: formattedPhone,
      first_name: firstName,
      last_name: lastName,
      contact_category: null,
      email: null
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert([contactData])
      .select();

    if (error) throw error;

    return data[0];
  } catch (error) {
    logError('createContact', error, { phoneNumber, name });
    return null;
  }
}

// Create a new interaction record in Supabase
async function createInteraction(data) {
  console.log('Creating interaction:', data);

  try {
    const { data: result, error } = await supabase
      .from('interactions')
      .insert([data]);

    if (error) throw error;

    return result;
  } catch (error) {
    logError('createInteraction', error, { data });
    throw error;
  }
}

// Parse incoming WhatsApp event from TimelinesAI
function parseWhatsAppEvent(eventData) {
  console.log('Received webhook payload:', JSON.stringify(eventData, null, 2));

  if (eventData.chat?.is_group || !eventData.chat?.phone) {
    console.log('Skipping group chat message or missing phone number');
    return [];
  }

  if (eventData.message) {
    return [{
      phoneNumber: eventData.chat.phone,
      senderName: eventData.chat.full_name,
      timestamp: eventData.message.timestamp,
      direction: eventData.message.direction,
      text: eventData.message.text,
      messageId: eventData.message.message_uid
    }];
  }

  return [];
}

// Validate phone number
function isValidPhoneNumber(phoneNumber) {
  const cleaned = phoneNumber?.replace(/\D/g, '');
  return cleaned?.length >= 10;
}

// Netlify function handler
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const messages = parseWhatsAppEvent(body);

    if (messages.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No individual chat messages to process' }) };
    }

    for (const messageData of messages) {
      const { phoneNumber, senderName, timestamp, direction, text } = messageData;
      if (!isValidPhoneNumber(phoneNumber)) continue;

      const formattedDate = formatTimestamp(timestamp);
      let contact = await findContactByPhone(phoneNumber);
      if (!contact) contact = await createContact(phoneNumber, senderName);

  const interactionData = {
    iteraction_date: formattedDate, // ✅ Correct column name
    iteraction_type: 'WhatsApp', // ✅ Fix column name typo
    contact_mobile: formatPhoneNumber(phoneNumber),
    contact_email: contact ? contact.email : null,
    direction: direction === 'sent' ? 'Outbound' : 'Inbound',
    note: text || '',
    contact_id: contact ? contact.id : null
  };


      if (contact?.id) interactionData.contact_id = contact.id;
      await createInteraction(interactionData);
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    logError('webhookHandler', error, { eventBody: event.body });
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

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

// Format timestamp to 'YYYY-MM-DD' for date type
function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0]; // Outputs "2025-02-26"
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
  console.log('Creating interaction with data:', JSON.stringify(data, null, 2));

  try {
    const response = await supabase
      .from('interactions')
      .insert([data])
      .select();

    console.log('Supabase response:', JSON.stringify(response, null, 2)); // Debug log

    const { data: result, error } = response;
    if (error) {
      console.log('Supabase error details:', JSON.stringify(error, null, 2)); // Log error details
      throw error;
    }

    console.log('Interaction created successfully:', result[0]);
    return result[0];
  } catch (error) {
    logError('createInteraction', error, { data });
    throw error;
  }
}

/**
 * Updates a contact's last_interaction date if the new date is more recent
 * @param {number} contactId - The ID of the contact to update
 * @param {string} interactionDate - The date of the interaction in ISO format
 */
async function updateContactLastInteraction(contactId, interactionDate) {
  try {
    // First get the current contact information
    const { data: contact, error: fetchError } = await supabase
      .from('contacts')
      .select('last_interaction')
      .eq('id', contactId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Only update if the new interaction date is more recent than the current last_interaction
    // or if last_interaction is null
    if (!contact.last_interaction || new Date(interactionDate) > new Date(contact.last_interaction)) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update({ last_interaction: interactionDate })
        .eq('id', contactId);
      
      if (updateError) throw updateError;
      console.log(`Updated contact ${contactId} last_interaction to ${interactionDate}`);
    }
  } catch (error) {
    console.error(`Error updating contact last_interaction: ${error.message}`);
    // We don't want to fail the whole webhook if just this update fails
    // So we log the error but don't rethrow it
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
    console.log('Parsed event body:', JSON.stringify(body, null, 2)); // Extra logging
    const messages = parseWhatsAppEvent(body);

    if (messages.length === 0) {
      console.log('No messages to process');
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No individual chat messages to process' }) };
    }

    for (const messageData of messages) {
      const { phoneNumber, senderName, timestamp, direction, text } = messageData;
      if (!isValidPhoneNumber(phoneNumber)) {
        console.log(`Skipping invalid phone number: ${phoneNumber}`);
        continue;
      }

      const formattedDate = formatTimestamp(timestamp);
      console.log(`Processing message from ${phoneNumber} on ${formattedDate}`);

      let contact = await findContactByPhone(phoneNumber);
      if (!contact) {
        console.log(`Contact not found, creating new one for ${phoneNumber}`);
        contact = await createContact(phoneNumber, senderName);
      }

      const interactionData = {
        interaction_date: formattedDate, // Corrected to match schema
        interaction_type: 'WhatsApp',    // Corrected to match schema
        contact_mobile: formatPhoneNumber(phoneNumber),
        contact_email: contact ? contact.email : null,
        direction: direction === 'sent' ? 'Outbound' : 'Inbound',
        note: text || '',
        contact_id: contact ? contact.id : null
      };

      await createInteraction(interactionData);
      
      // Update the contact's last_interaction date
      if (interactionData.contact_id && interactionData.interaction_date) {
        await updateContactLastInteraction(
          interactionData.contact_id,
          interactionData.interaction_date
        );
      }
    }

    console.log('All messages processed successfully');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    logError('webhookHandler', error, { eventBody: event.body });
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

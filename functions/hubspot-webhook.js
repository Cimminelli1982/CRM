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

// Format timestamp to 'YYYY-MM-DD' for date type
function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0]; // Outputs "2025-02-26"
}

// Find contact by email in Supabase (since emails are key for HubSpot)
async function findContactByEmail(email) {
  console.log('Looking up contact with email:', email);

  try {
    if (!email) return null;
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (error) throw error;

    return data.length > 0 ? data[0] : null;
  } catch (error) {
    logError('findContactByEmail', error, { email });
    return null;
  }
}

// Create a new contact in Supabase
async function createContact(email, name = null) {
  console.log('Creating new contact for email:', email);

  try {
    let firstName = null;
    let lastName = null;

    if (name) {
      const nameParts = name.split(' ');
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ') || null;
    }

    const contactData = {
      email: email,
      first_name: firstName,
      last_name: lastName,
      mobile: null, // No mobile for emails, but keep the field for consistency
      contact_category: null
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert([contactData])
      .select();

    if (error) throw error;

    return data[0];
  } catch (error) {
    logError('createContact', error, { email, name });
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

// Parse incoming HubSpot email event
function parseHubSpotEmailEvent(eventData) {
  console.log('Received webhook payload:', JSON.stringify(eventData, null, 2));

  // HubSpot webhook payload structure for email creation
  if (!eventData.objectId || eventData.objectType !== 'EMAIL') {
    console.log('Skipping non-email event or missing objectId');
    return null;
  }

  const emailProperties = eventData.properties || {};
  const direction = emailProperties.hs_email_direction || 'UNKNOWN'; // e.g., "INBOUND" or "OUTBOUND"
  const subject = emailProperties.subject || 'No subject';
  const fromEmail = emailProperties.from || null;
  const toEmail = emailProperties.to || null;
  const timestamp = eventData.occurredAt || new Date().toISOString();

  // Use 'to' email as the primary contact email (since you want sent/received emails)
  const contactEmail = toEmail || fromEmail; // Prioritize recipient, but include sender if no recipient
  const senderName = emailProperties.from_name || null; // Name of the sender, if available

  if (!contactEmail) {
    console.log('Skipping email event without contact email');
    return null;
  }

  return {
    contactEmail,
    senderName,
    timestamp,
    direction: direction === 'INBOUND' ? 'Inbound' : 'Outbound',
    subject
  };
}

// Netlify function handler
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    console.log('Parsed event body:', JSON.stringify(body, null, 2)); // Extra logging
    const emailData = parseHubSpotEmailEvent(body);

    if (!emailData) {
      console.log('No email data to process');
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No email data to process' }) };
    }

    const { contactEmail, senderName, timestamp, direction, subject } = emailData;
    const formattedDate = formatTimestamp(timestamp);

    console.log(`Processing email for ${contactEmail} on ${formattedDate}`);

    let contact = await findContactByEmail(contactEmail);
    if (!contact) {
      console.log(`Contact not found, creating new one for ${contactEmail}`);
      contact = await createContact(contactEmail, senderName);
    }

    const interactionData = {
      interaction_date: formattedDate,
      interaction_type: 'email', // Hardcoded as requested
      contact_email: contactEmail,
      contact_mobile: contact ? contact.mobile : null,
      direction: direction,
      note: subject || '', // Use subject as the note/content
      contact_id: contact ? contact.id : null
    };

    await createInteraction(interactionData);

    console.log('Email processed successfully');
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    logError('webhookHandler', error, { eventBody: event.body });
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

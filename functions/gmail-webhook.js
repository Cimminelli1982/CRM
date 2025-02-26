// functions/gmail-webhook.js

const Airtable = require('airtable');

// Initialize Airtable
const base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base(process.env.AIRTABLE_BASE_ID);
const table = base('Contacts');

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

// Find contact by email in Airtable
async function findContactByEmail(email) {
  console.log('Searching for contact with email:', email);
  
  try {
    const records = await table.select({
      filterByFormula: `{Primary email} = '${email}'`
    }).firstPage();
    
    console.log(`Found ${records.length} matching contacts`);
    return records.length > 0 ? records[0] : null;
  } catch (error) {
    logError('findContactByEmail', error, { email });
    throw error;
  }
}

// Format timestamp for Airtable Date field
function formatTimestamp(timestamp) {
  // Parse the input timestamp
  const date = new Date(timestamp);
  // Return just the date part in YYYY-MM-DD format
  return date.toISOString().split('T')[0];
}

// Update contact's email timestamp
async function updateContactEmailTimestamp(recordId, direction, timestamp) {
  console.log('Updating contact:', { recordId, direction, timestamp });
  
  const fieldToUpdate = direction === 'sent' ? 'Last Email Sent' : 'Last Email Received';
  const formattedDate = formatTimestamp(timestamp);
  
  console.log('Formatted date for Airtable:', formattedDate);
  
  try {
    await table.update(recordId, {
      [fieldToUpdate]: formattedDate
    });
    
    console.log('Contact updated successfully');
  } catch (error) {
    logError('updateContactEmailTimestamp', error, { recordId, direction, timestamp, formattedDate });
    throw error;
  }
}

// Create new contact from email
async function createNewContactFromEmail(email, direction, timestamp) {
  console.log('Creating new contact:', { email, direction, timestamp });
  
  const formattedDate = formatTimestamp(timestamp);
  console.log('Formatted date for new contact:', formattedDate);

  const newContact = {
    'Primary email': email,
    'Last Email Sent': direction === 'sent' ? formattedDate : null,
    'Last Email Received': direction === 'received' ? formattedDate : null
  };

  try {
    const record = await table.create(newContact);
    console.log('Contact created successfully:', record.getId());
  } catch (error) {
    logError('createNewContactFromEmail', error, { newContact });
    throw error;
  }
}

// Parse Zapier Gmail data
function parseGmailEvent(eventData) {
  console.log('Received Gmail webhook payload:', JSON.stringify(eventData, null, 2));
  
  return {
    email: eventData.from_email,
    timestamp: eventData.date,
    direction: eventData.direction || 'received'
  };
}

// Netlify function handler
exports.handler = async (event, context) => {
  console.log('Received webhook request:', {
    method: event.httpMethod,
    headers: event.headers,
    path: event.path
  });

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.warn('Rejected non-POST request');
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const emailData = parseGmailEvent(body);
    
    // Check if contact exists
    const existingContact = await findContactByEmail(emailData.email);
    
    if (existingContact) {
      console.log('Updating existing contact:', existingContact.id);
      await updateContactEmailTimestamp(existingContact.id, emailData.direction, emailData.timestamp);
    } else {
      console.log('Creating new contact for email:', emailData.email);
      await createNewContactFromEmail(emailData.email, emailData.direction, emailData.timestamp);
    }

    console.log('Successfully processed email');
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

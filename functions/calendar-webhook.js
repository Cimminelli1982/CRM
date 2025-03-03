const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Enhanced logging function
function logMessage(level, context, message, additionalData = {}) {
  console[level]({
    timestamp: new Date().toISOString(),
    context,
    message,
    additionalData
  });
}

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

// Format date from Google Calendar to Supabase format
function formatDate(googleDate) {
  // Check if the date is already in ISO format with time
  if (googleDate.includes('T')) {
    return googleDate.split('T')[0]; // Returns YYYY-MM-DD
  }
  
  // If it's just a date string, try to convert it
  try {
    return new Date(googleDate).toISOString().split('T')[0];
  } catch (error) {
    logError('formatDate', error, { input: googleDate });
    return googleDate; // Return original if parsing fails
  }
}

// Find contact by email in Supabase
async function findContactByEmail(email) {
  logMessage('log', 'findContactByEmail', `Looking up contact with email: ${email}`);

  try {
    // Check all email fields (email1, email2, email3)
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .or(`email.eq.${email},email2.eq.${email},email3.eq.${email}`)
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      logMessage('log', 'findContactByEmail', `Found contact for email ${email}`, { contactId: data[0].id });
      return data[0];
    } else {
      logMessage('log', 'findContactByEmail', `No contact found for email ${email}`);
      return null;
    }
  } catch (error) {
    logError('findContactByEmail', error, { email });
    return null;
  }
}

// Create a new contact in Supabase
async function createContact(email, name = null) {
  logMessage('log', 'createContact', `Creating new contact for email: ${email}`);

  try {
    let firstName = null;
    let lastName = null;

    if (name) {
      const nameParts = name.split(' ');
      firstName = nameParts[0];
      lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
    }

    const contactData = {
      email,
      first_name: firstName,
      last_name: lastName,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert([contactData])
      .select();

    if (error) throw error;

    logMessage('log', 'createContact', `Contact created successfully for ${email}`, { contactId: data[0].id });
    return data[0];
  } catch (error) {
    logError('createContact', error, { email, name });
    return null;
  }
}

// Find or create contact by email
async function findOrCreateContact(email, name = null) {
  if (!email) return null;
  
  try {
    // First, try to find existing contact
    const contact = await findContactByEmail(email);
    
    // If contact exists, return it
    if (contact) return contact;
    
    // If no contact, create a new one
    return await createContact(email, name);
  } catch (error) {
    logError('findOrCreateContact', error, { email, name });
    return null;
  }
}

// Create a Google Calendar meeting record
async function createGoogleCalendarMeeting(meetingData) {
  logMessage('log', 'createGoogleCalendarMeeting', 'Creating Google Calendar meeting record', meetingData);

  try {
    const { data, error } = await supabase
      .from('google_calendar')
      .insert([meetingData])
      .select();

    if (error) throw error;

    logMessage('log', 'createGoogleCalendarMeeting', 'Meeting record created successfully', { meetingId: data[0].id });
    return data[0];
  } catch (error) {
    logError('createGoogleCalendarMeeting', error, { meetingData });
    throw error;
  }
}

// Associate contact with Google Calendar meeting
async function associateContactWithMeeting(googleCalendarId, contactId) {
  logMessage('log', 'associateContactWithMeeting', 'Associating contact with meeting', { 
    googleCalendarId, 
    contactId 
  });

  try {
    const { data, error } = await supabase
      .from('google_calendar_contacts')
      .insert([{
        google_calendar_id: googleCalendarId,
        contact_id: contactId
      }])
      .select();

    if (error) throw error;

    logMessage('log', 'associateContactWithMeeting', 'Contact associated with meeting successfully');
    return data[0];
  } catch (error) {
    logError('associateContactWithMeeting', error, { googleCalendarId, contactId });
    // Don't throw here to prevent entire process from failing due to one association
  }
}

/**
 * Updates a contact's last_interaction date if the new date is more recent
 * @param {number} contactId - The ID of the contact to update
 * @param {string} interactionDate - The date of the interaction in ISO format
 */
async function updateContactLastInteraction(contactId, interactionDate) {
  try {
    // Format date properly
    const formattedDate = formatDate(interactionDate);
    
    // First get the current contact information
    const { data: contact, error: fetchError } = await supabase
      .from('contacts')
      .select('last_interaction')
      .eq('id', contactId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Only update if the new interaction date is more recent than the current last_interaction
    // or if last_interaction is null
    if (!contact.last_interaction || new Date(formattedDate) > new Date(contact.last_interaction)) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update({ last_interaction: formattedDate })
        .eq('id', contactId);
      
      if (updateError) throw updateError;
      logMessage('log', 'updateContactLastInteraction', `Updated contact ${contactId} last_interaction to ${formattedDate}`);
    }
  } catch (error) {
    logError('updateContactLastInteraction', error, { contactId, interactionDate });
    // We don't want to fail the whole webhook if just this update fails
    // So we log the error but don't rethrow it
  }
}

// Process attendee emails from calendar event
function processAttendeeEmails(attendeeEmails) {
  if (!attendeeEmails) return [];
  
  // If it's a string, split by comma
  const emailsArray = typeof attendeeEmails === 'string' 
    ? attendeeEmails.split(',') 
    : attendeeEmails;
  
  // Filter out simone@cimminelli.com and empty values
  return emailsArray
    .map(email => email.trim())
    .filter(email => email && email.toLowerCase() !== 'simone@cimminelli.com');
}

// Netlify function handler
exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method not allowed' }) 
    };
  }

  try {
    logMessage('log', 'handler', 'Processing calendar webhook event');
    const webhookData = JSON.parse(event.body);
    logMessage('log', 'handler', 'Parsed webhook data', webhookData);

    // 1. Extract attendee emails and process contacts
    const attendeeEmails = processAttendeeEmails(webhookData.attendee_emails);
    logMessage('log', 'handler', `Processing ${attendeeEmails.length} attendee emails`, { emails: attendeeEmails });

    const contactPromises = [];
    const contactIds = [];

    // Process each attendee email
    for (const email of attendeeEmails) {
      contactPromises.push(
        findOrCreateContact(email)
          .then(contact => {
            if (contact) {
              contactIds.push(contact.id);
              
              // Update last_interaction for each contact
              if (webhookData.event_date) {
                updateContactLastInteraction(contact.id, webhookData.event_date);
              }
            }
            return contact;
          })
      );
    }

    // Wait for all contact processing to complete
    await Promise.all(contactPromises);
    logMessage('log', 'handler', `Processed ${contactIds.length} contacts`, { contactIds });

    // 2. Record meeting in google_calendar
    const meetingData = {
      interaction_type: 'Google Meet',
      interaction_date: formatDate(webhookData.event_date),
      meeting_name: webhookData.summary || 'Untitled Meeting',
      description: webhookData.description || ''
      // Add any other fields needed
    };

    const meeting = await createGoogleCalendarMeeting(meetingData);
    logMessage('log', 'handler', 'Created Google Calendar meeting record', { 
      meetingId: meeting.id, 
      meetingName: meeting.meeting_name 
    });

    // 3. Associate attendees with the meeting
    for (const contactId of contactIds) {
      await associateContactWithMeeting(meeting.id, contactId);
    }
    
    logMessage('log', 'handler', 'Successfully processed calendar webhook');
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Calendar event processed successfully',
        meeting_id: meeting.id,
        contacts_processed: contactIds.length
      })
    };
  } catch (error) {
    logError('handler', error, { eventBody: event.body });
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process calendar webhook', 
        details: error.message 
      })
    };
  }
};

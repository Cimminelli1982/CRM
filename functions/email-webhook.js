const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Utility function to format phone number (if needed)
function formatPhoneNumber(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// Find or create contact by email
async function findOrCreateContact(email, name = null) {
  try {
    // First, try to find existing contact
    const { data: existingContacts, error: findError } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (findError) throw findError;

    // If contact exists, return it
    if (existingContacts.length > 0) {
      return existingContacts[0];
    }

    // If no contact, create a new one
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

    const { data: newContacts, error: createError } = await supabase
      .from('contacts')
      .insert([{
        email,
        first_name: firstName,
        last_name: lastName,
        created_at: new Date().toISOString()
      }])
      .select();

    if (createError) throw createError;

    return newContacts[0];
  } catch (error) {
    console.error('Error in findOrCreateContact:', error);
    return null;
  }
}

// Create interaction record
async function createInteraction(interactionData) {
  try {
    const { data, error } = await supabase
      .from('interactions')
      .insert([interactionData]);

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error creating interaction:', error);
    return null;
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
    const webhookData = JSON.parse(event.body);

    // Determine direction and contact
    const myEmail = 'simone@cimminelli.com';
    const direction = webhookData['from email'] === myEmail ? 'Outbound' : 'Inbound';
    const contactEmail = direction === 'Inbound' 
      ? webhookData['from email'] 
      : webhookData['to email'];

    // Find or create contact
    const contact = await findOrCreateContact(
      contactEmail, 
      direction === 'Inbound' 
        ? webhookData['from name'] 
        : webhookData['to name']
    );

    // Prepare interaction data
    const interactionData = {
      interaction_date: new Date(webhookData.date).toISOString().split('T')[0],
      interaction_type: 'Email',
      contact_email: contactEmail,
      direction: direction,
      note: webhookData.subject || 'No subject',
      contact_id: contact ? contact.id : null
    };

    // Create interaction
    await createInteraction(interactionData);
    
    // Update the contact's last_interaction date
    if (interactionData.contact_id && interactionData.interaction_date) {
      await updateContactLastInteraction(
        interactionData.contact_id,
        interactionData.interaction_date
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Email interaction logged successfully' 
      })
    };

  } catch (error) {
    console.error('Webhook processing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process webhook', 
        details: error.message 
      })
    };
  }
};

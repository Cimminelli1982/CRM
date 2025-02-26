const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  const hubspotApiKey = process.env.HUBSPOT_API_KEY;
  const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID;
  const airtableApiKey = process.env.AIRTABLE_API_KEY;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  const airtableTableId = process.env.AIRTABLE_TABLE_ID;

  const { recordId, email, fullName } = event.queryStringParameters;

  const htmlTemplate = (message, isError = false) => `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f0f0; }
          .container { text-align: center; padding: 20px; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .message { color: ${isError ? '#dc3545' : '#28a745'}; margin-bottom: 20px; }
          .close-button { background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; }
          .close-button:hover { background-color: #0056b3; }
        </style>
      </head>
      <body>
        <div class="container">
          <p class="message">${message}</p>
          <button class="close-button" onclick="window.close()">Close this tab</button>
        </div>
      </body>
    </html>
  `;

  try {
    // First check if HubSpot ID already exists and is a number
    const airtableResponse = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`, {
      headers: {
        'Authorization': `Bearer ${airtableApiKey}`
      }
    });
    const airtableData = await airtableResponse.json();
    
    if (airtableData.fields['HubSpot ID'] && !isNaN(airtableData.fields['HubSpot ID'])) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: htmlTemplate('Record already has a valid HubSpot ID')
      };
    }

    // If no existing HubSpot ID, proceed with search
    let searchData;
    if (email) {
      // Search by email first
      const emailSearchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: 'EQ',
                  value: email
                }
              ]
            },
            {
              filters: [
                {
                  propertyName: 'hs_additional_emails',
                  operator: 'CONTAINS_TOKEN',
                  value: email
                }
              ]
            }
          ]
        })
      });
      searchData = await emailSearchResponse.json();
    }

    // If no match by email and full name is provided, try name search
    if ((!searchData || searchData.total === 0) && fullName) {
      const nameSearchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hubspotApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'firstname',
                  operator: 'CONTAINS_TOKEN',
                  value: fullName.split(' ')[0]
                },
                {
                  propertyName: 'lastname',
                  operator: 'CONTAINS_TOKEN',
                  value: fullName.split(' ').slice(-1)[0]
                }
              ]
            }
          ]
        })
      });
      searchData = await nameSearchResponse.json();
    }

    if (searchData && searchData.total > 0) {
      const hubspotId = searchData.results[0].id;
      const hubspotUrl = `https://app-eu1.hubspot.com/contacts/${hubspotPortalId}/contact/${hubspotId}`;

      const updateData = {
        fields: {
          'HubSpot ID': hubspotId,
          'HubSpot URL': hubspotUrl
        }
      };

      const updateResponse = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${airtableApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update Airtable record');
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: htmlTemplate('Successfully updated Airtable record!')
      };
    } else {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: htmlTemplate('No matching HubSpot contact found', true)
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlTemplate(`Error: ${error.message}`, true)
    };
  }
};
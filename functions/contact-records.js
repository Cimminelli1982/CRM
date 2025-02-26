const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const airtableApiKey = process.env.AIRTABLE_API_KEY;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;
  const airtableTableId = process.env.AIRTABLE_TABLE_ID;
  const hubspotAccessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  const hubspotPortalId = "144666820"; // Adding this for HubSpot view links

  const { contactId, action, source, recordId } = event.queryStringParameters;

  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html" },
      body: `<html><body><h2>Contact ID is required</h2></body></html>`,
    };
  }

  try {
    // Handle delete action
    if (action === 'delete') {
      if (source === 'Airtable') {
        const deleteResponse = await fetch(
          `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${airtableApiKey}`
            }
          }
        );

        if (!deleteResponse.ok) {
          throw new Error('Failed to delete Airtable record');
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Record deleted successfully' })
        };
      }

      if (source === 'HubSpot') {
        const deleteResponse = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${recordId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${hubspotAccessToken}`
            }
          }
        );

        if (!deleteResponse.ok) {
          throw new Error('Failed to delete HubSpot record');
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Record deleted successfully' })
        };
      }
    }

    // Handle merge action
    if (action === 'merge') {
      const recordsToMerge = event.queryStringParameters.records.split(',');
      
      if (recordsToMerge.length < 2) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'At least 2 records are required for merging' })
        };
      }

      const primaryRecord = recordsToMerge[0];
      const secondaryRecords = recordsToMerge.slice(1);

      const mergeResponse = await fetch(
        'https://api.hubapi.com/crm/v3/objects/contacts/merge',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            primaryObjectId: primaryRecord,
            objectIdToMerge: secondaryRecords[0]
          })
        }
      );

      if (!mergeResponse.ok) {
        throw new Error('Failed to merge HubSpot records');
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Records merged successfully' })
      };
    }

// Handle syncing HubSpot ID to Airtable
    if (action === 'syncHubspotId') {
      console.log('Starting HubSpot ID sync...');
      const hubspotId = event.queryStringParameters.hubspotId;
      const airtableRecordId = event.queryStringParameters.airtableRecordId;
      
      console.log('Parameters:', {
        hubspotId,
        airtableRecordId,
        contactId
      });

      try {
        const updateResponse = await fetch(
          `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${airtableRecordId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${airtableApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                'HubSpot ID': hubspotId
              }
            })
          }
        );

        console.log('Airtable response status:', updateResponse.status);
        const responseData = await updateResponse.json();
        console.log('Airtable response:', responseData);

        if (!updateResponse.ok) {
          console.error('Failed to update:', responseData);
          throw new Error('Failed to update HubSpot ID in Airtable');
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: 'HubSpot ID updated successfully in Airtable',
            data: responseData 
          })
        };
      } catch (error) {
        console.error('Sync error:', error);
        throw error;
      }
    }

    // Handle syncing Airtable ID to HubSpot
    if (action === 'syncAirtableId') {
      const airtableId = event.queryStringParameters.airtableId;
      const hubspotRecordId = event.queryStringParameters.hubspotRecordId;
      
      const updateResponse = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${hubspotRecordId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${hubspotAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              'airtable_id': airtableId
            }
          })
        }
      );

      if (!updateResponse.ok) {
        throw new Error('Failed to update Airtable ID in HubSpot');
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Airtable ID updated successfully in HubSpot' })
      };
    }

    // Regular view - fetch records
    const airtableFieldsToShow = [
      { airtableField: "Full Name", displayName: "Full Name" },
      { airtableField: "Last contact", displayName: "Last contact" },
      { airtableField: "Contact Airtable ID", displayName: "Contact Airtable ID" },
      { airtableField: "HubSpot ID", displayName: "HubSpot ID" },
      { airtableField: "Main Category", displayName: "Main category" },
      { airtableField: "Job Title", displayName: "Job title" },
      { airtableField: "Company (string from Hubspot)", displayName: "Company" },
      { airtableField: "Keywords", displayName: "Keywords" },
      { airtableField: "Mobile phone number", displayName: "Mobile phone number" },
      { airtableField: "Phone number (from timelines)", displayName: "Phone number (from timelines)" },
      { airtableField: "Primary email", displayName: "Primary email" },
      { airtableField: "Linkedin adjusted", displayName: "Linkedin" },
    ];

    // Fetch Airtable Records
    const airtableSearchUrl = `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}?filterByFormula={Contact}="${contactId}"`;
    const airtableResponse = await fetch(airtableSearchUrl, {
      headers: { Authorization: `Bearer ${airtableApiKey}` },
    });

    if (!airtableResponse.ok) {
      throw new Error("Failed to fetch records from Airtable.");
    }

    const airtableData = await airtableResponse.json();
    const filteredAirtableRecords = airtableData.records.map((record) => {
      const filteredFields = {};
      airtableFieldsToShow.forEach(({ airtableField, displayName }) => {
        if (record.fields[airtableField]) {
          filteredFields[displayName] = record.fields[airtableField];
        }
      });
      return { source: "Airtable", fields: filteredFields, id: record.id };
    });

    // Fetch HubSpot Records
    const hubspotSearchUrl = `https://api.hubapi.com/crm/v3/objects/contacts/search`;
    const hubspotSearchPayload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "firstname",
              operator: "CONTAINS_TOKEN",
              value: contactId.split(" ")[0],
            },
            {
              propertyName: "lastname",
              operator: "CONTAINS_TOKEN",
              value: contactId.split(" ")[1],
            },
          ],
        },
      ],
      properties: ["firstname", "lastname", "email", "phone", "hs_object_id"],
      limit: 50,
    };

    const hubspotResponse = await fetch(hubspotSearchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hubspotAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(hubspotSearchPayload),
    });

    if (!hubspotResponse.ok) {
      throw new Error("Failed to fetch records from HubSpot.");
    }

    const hubspotData = await hubspotResponse.json();
    const hubspotRecords = hubspotData.results.map((result) => ({
      source: "HubSpot",
      fields: {
        "Full Name": `${result.properties.firstname || "N/A"} ${result.properties.lastname || "N/A"}`,
        "Last contact": result.properties.notes_last_updated || "N/A",
        "Contact Airtable ID": "",
        "HubSpot ID": result.id,
        "Main category": result.properties.people_category_ies_ || "N/A",
        "Mobile phone number": result.properties.phone || "N/A",
        "Phone number (from timelines)": result.properties.mobilephone || "N/A",
        "Primary email": result.properties.email || "N/A",
        "Linkedin": result.properties.hs_linkedin_url || "N/A",
      },
      id: result.id,
    }));

    const htmlTemplate = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #f0f0f0; }
            .container { display: flex; }
            .column { flex: 1; margin-right: 20px; }
            .record { border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 4px; background-color: white; }
            .record:hover { background-color: #f8f9fa; }
            .field-name { font-weight: bold; color: #666; }
            .delete-btn { margin-top: 10px; padding: 8px 12px; background-color: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; }
            .delete-btn:hover { background-color: #c82333; }
            .merge-btn { margin-bottom: 20px; padding: 8px 12px; background-color: #0077cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
            .merge-btn:hover { background-color: #005fa3; }
            .merge-checkbox { margin: 10px; }
            .view-btn {
              margin-top: 10px;
              margin-right: 10px;
              padding: 8px 12px;
              background-color: #4CAF50;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
            }
            .view-btn:hover {
              background-color: #45a049;
            }
            .button-group {
              margin-top: 10px;
            }
          </style>
          <script>
            const contactId = "${contactId}"; // Add this line to define contactId
            let selectedRecords = [];

            function updateMergeSelection(checkbox) {
              if (checkbox.checked) {
                selectedRecords.push(checkbox.value);
              } else {
                selectedRecords = selectedRecords.filter(id => id !== checkbox.value);
              }
            }

            function mergeRecords() {
              if (selectedRecords.length < 2) {
                alert('Please select at least 2 records to merge');
                return;
              }
              
              if (confirm("Are you sure you want to merge these records? This action cannot be undone.")) {
                fetch(\`?action=merge&records=\${selectedRecords.join(',')}&contactId=${contactId}\`, { 
                  method: "GET"
                })
                  .then(response => response.json())
                  .then(data => {
                    if (data.error) {
                      throw new Error(data.error);
                    }
                    alert(data.message);
                    window.location.reload();
                  })
                  .catch(error => alert("Error merging records: " + error.message));
              }
            }

            function deleteRecord(source, recordId) {
              if (confirm("Are you sure you want to delete this record?")) {
                fetch(\`?action=delete&source=\${source}&recordId=\${recordId}&contactId=${contactId}\`, { 
                  method: "GET"
                })
                  .then(response => response.json())
                  .then(data => {
                    if (data.error) {
                      throw new Error(data.error);
                    }
                    alert(data.message);
                    window.location.reload();
                  })
                  .catch(error => alert("Error deleting record: " + error.message));
              }
            }

function syncHubspotId(hubspotId, airtableRecordId) {
              if (confirm("Are you sure you want to sync the HubSpot ID to Airtable?")) {
                console.log('Syncing HubSpot ID:', hubspotId, 'to Airtable record:', airtableRecordId);
                fetch("?action=syncHubspotId&hubspotId=" + hubspotId + "&airtableRecordId=" + airtableRecordId + "&contactId=" + contactId)
                  .then(response => {
                    console.log('Response status:', response.status);
                    return response.json().then(data => ({status: response.status, data}));
                  })
                  .then(({status, data}) => {
                    console.log('Response data:', data);
                    if (status === 200) {
                      alert(data.message);
                      window.location.reload();
                    } else {
                      throw new Error(data.message || 'Failed to sync');
                    }
                  })
                  .catch(error => {
                    console.error('Error:', error);
                    alert("Error syncing HubSpot ID: " + error.message);
                  });
              }
            }

            function syncAirtableId(airtableId, hubspotRecordId) {
              if (confirm("Are you sure you want to sync the Airtable ID to HubSpot?")) {
                fetch("?action=syncAirtableId&airtableId=" + airtableId + "&hubspotRecordId=" + hubspotRecordId + "&contactId=" + contactId)
                  .then(response => response.json())
                  .then(data => {
                    alert(data.message);
                    window.location.reload();
                  })
                  .catch(error => alert("Error syncing Airtable ID: " + error.message));
              }
            }
          </script>
        </head>
        <body>
          <div class="container">
            <div style="max-width: 1200px; margin: 0 auto; padding: 20px;">
            <div style="display: flex; justify-content: flex-end; margin-bottom: 20px; gap: 10px;">
              ${(filteredAirtableRecords.length > 0 && hubspotRecords.length > 0) ? `
                <button 
                  onclick="syncHubspotId('${hubspotRecords[0].id}', '${filteredAirtableRecords[0].id}')"
                  style="padding: 8px 16px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;"
                >
                  Sync HubSpot ID to Airtable
                </button>
                <button 
                  onclick="syncAirtableId('${filteredAirtableRecords[0].fields['Contact Airtable ID']}', '${hubspotRecords[0].id}')"
                  style="padding: 8px 16px; background-color: #008CBA; color: white; border: none; border-radius: 4px; cursor: pointer;"
                >
                  Sync Airtable ID to HubSpot
                </button>
              ` : ''}
            </div>
            <div class="container" style="display: flex; gap: 20px;">
              <div class="column">
                <h2>Airtable Records</h2>
                ${filteredAirtableRecords.length
                  ? filteredAirtableRecords
                      .map(
                        (record) => `
                    <div class="record">
                      ${Object.entries(record.fields)
                        .map(
                          ([key, value]) => `
                        <div>
                          <span class="field-name">${key}:</span> 
                          <span>${value}</span>
                        </div>
                    `
                      )
                      .join("")}
                    <div class="button-group">
                      <a href="https://airtable.com/${airtableBaseId}/pagknyvJzu0i0bCE3?9HzLA=${record.id}" target="_blank" class="view-btn">View in Airtable</a>
                      <button class="delete-btn" onclick="deleteRecord('Airtable', '${record.id}')">Delete</button>
                    </div>
                  </div>
                `
                    )
                    .join("")
                : "<div>No Airtable records found.</div>"}
            </div>
            <div class="column">
              <h2>HubSpot Records</h2>
              ${hubspotRecords.length > 1 ? `
                <button class="merge-btn" onclick="mergeRecords()">Merge Selected Records</button>
              ` : ''}
              ${hubspotRecords.length
                ? hubspotRecords
                    .map(
                      (record) => `
                  <div class="record">
                    ${hubspotRecords.length > 1 ? 
                      `<input type="checkbox" class="merge-checkbox" value="${record.id}" onchange="updateMergeSelection(this)">` 
                      : ''
                    }
                    ${Object.entries(record.fields)
                      .map(
                        ([key, value]) => `
                      <div>
                        <span class="field-name">${key}:</span> 
                        <span>${value}</span>
                      </div>
                    `
                      )
                      .join("")}
                    <div class="button-group">
                      <a href="https://app.hubspot.com/contacts/${hubspotPortalId}/contact/${record.id}" target="_blank" class="view-btn">View in HubSpot</a>
                      <button class="delete-btn" onclick="deleteRecord('HubSpot', '${record.id}')">Delete</button>
                    </div>
                  </div>
                `
                    )
                    .join("")
                : "<div>No HubSpot records found.</div>"}
            </div>
          </div>
        </body>
      </html>
    `;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: htmlTemplate,
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: `<html><body><h2>Error: ${error.message}</h2></body></html>`,
    };
  }
};

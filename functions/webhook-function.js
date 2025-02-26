const Airtable = require('airtable');

const base = new Airtable({
  apiKey: 'pat66J9WlPFS2Q8NH.605213e5a6cf180b4ed4320866bffe1bd248205fd064b8775d071c613da2bdd5'
}).base('appTMYAU4N43eJdxG');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const date = new Date().toISOString().split('T')[0];
    
    // Get emails from webhook data
    const emails = [
      data.from,
      ...(data.to || [])
    ].filter(email => email !== 'simone@cimminelli.com');

    // Update records in Airtable
    for (const email of emails) {
      const records = await base('TEST AREA').select({
        filterByFormula: `{Email} = '${email}'`
      }).firstPage();

      for (const record of records) {
        await base('TEST AREA').update(record.id, {
          'Last Contact': date
        });
        console.log(`Updated record ${record.id} for email ${email}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Success' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

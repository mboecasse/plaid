'use strict';

const util = require('util');
const querystring = require('querystring');

const envvar = require('envvar');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const plaid = require('plaid');
const convertXml = require('xml-js');
const rp = require('request-promise');

const APP_PORT = envvar.number('PORT', 8000);
const APP_SECRET_SESSION = envvar.string('APP_SECRET_SESSION', 'dsfljdsjklfnsqfneilzuflez');
const ZOHO_ACCESS_TOKEN = envvar.string('ZOHO_ACCESS_TOKEN');
const PLAID_CLIENT_ID = envvar.string('PLAID_CLIENT_ID');
const PLAID_SECRET = envvar.string('PLAID_SECRET');
const PLAID_PUBLIC_KEY = envvar.string('PLAID_PUBLIC_KEY');
const PLAID_ENV = envvar.string('PLAID_ENV', 'sandbox');
// PLAID_PRODUCTS is a comma-separated list of products to use when initializing
// Link. Note that this list must contain 'assets' in order for the app to be
// able to create and retrieve asset reports.
const PLAID_PRODUCTS = envvar.string('PLAID_PRODUCTS', 'transactions');

// PLAID_PRODUCTS is a comma-separated list of countries for which users
// will be able to select institutions from.
const PLAID_COUNTRY_CODES = envvar.string('PLAID_COUNTRY_CODES', 'US,CA');

// Parameters used for the OAuth redirect Link flow.
//
// Set PLAID_OAUTH_REDIRECT_URI to 'http://localhost:8000/oauth-response.html'
// The OAuth redirect flow requires an endpoint on the developer's website
// that the bank website should redirect to. You will need to whitelist
// this redirect URI for your client ID through the Plaid developer dashboard
// at https://dashboard.plaid.com/team/api.
const PLAID_OAUTH_REDIRECT_URI = envvar.string('PLAID_OAUTH_REDIRECT_URI', 'http://localhost:8000/confirm-payment.html');
// Set PLAID_OAUTH_NONCE to a unique identifier such as a UUID for each Link
// session. The nonce will be used to re-open Link upon completion of the OAuth
// redirect. The nonce must be at least 16 characters long.
const PLAID_OAUTH_NONCE = envvar.string('PLAID_OAUTH_NONCE', '');

// We store the access_token in memory - in production, store it in a secure
// persistent data store
let ACCESS_TOKEN = null;
let PUBLIC_TOKEN = null;
let ITEM_ID = null;
// The payment_token is only relevant for the UK Payment Initiation product.
// We store the payment_token in memory - in production, store it in a secure
// persistent data store
// let PAYMENT_TOKEN = null;
let PAYMENT_ID = null;

// Initialize the Plaid client
// Find your API keys in the Dashboard (https://dashboard.plaid.com/account/keys)
const client = new plaid.Client(
    PLAID_CLIENT_ID,
    PLAID_SECRET,
    PLAID_PUBLIC_KEY,
    plaid.environments[PLAID_ENV],
    {version: '2019-05-29', clientApp: 'My Susu'}
);

const app = express();
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
    extended: false,
}));
app.use(bodyParser.json({ type: req => true }));

const sess = {
    secret: APP_SECRET_SESSION,
    cookie: {
        httpOnly: true,
        maxAge: 6000000,
        sameSite: 'lax',
    },
    store: new FileStore({retries: 1}),
    resave: false,
    saveUninitialized: false,
    unset: 'destroy',
};

if (app.get('env') === 'production') {
    app.set('trust proxy', 1); // trust first proxy
    sess.cookie.secure = true; // serve secure cookies
}

app.use(session(sess));

app.get('/', async (request, response, next) => {
    response.render('index.ejs', {
        PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
        PLAID_ENV: PLAID_ENV,
        PLAID_PRODUCTS: PLAID_PRODUCTS,
        PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
        PLAID_OAUTH_REDIRECT_URI: '',
        PLAID_OAUTH_NONCE: '',
        ITEM_ID: ITEM_ID,
        ACCESS_TOKEN: ACCESS_TOKEN,
    });
});

app.get('/init-payment.html', (request, response) => {
    const handler = async (error) => {
        const { transacid } = request.query;
        // udpate Zoho Status
        await updatePaymentInZhoho({status: 'payment_pending'}, transacid);

        if (error) {
            response.render('error.ejs', { error });
        } else {
            response.render('init-payment.ejs', {
                PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
                PLAID_ENV: PLAID_ENV,
                PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
                PLAID_OAUTH_REDIRECT_URI: PLAID_OAUTH_REDIRECT_URI,
                PLAID_OAUTH_NONCE: PLAID_OAUTH_NONCE,
                TRANSAC_ID: transacid,
            });
        }
    };

    request.session.regenerate(handler);
});

// This is an endpoint defined for the OAuth flow to redirect to.
app.get('/confirm-payment.html', async (request, response) => {
    try {
        const { referenceId } = request.session;
        console.log('req', request.session);

        // udpate Zoho Status
        await updatePaymentInZhoho({status: 'confirmed'}, referenceId);

        response.render('confirm-payment.ejs', {
            PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
            PLAID_ENV: PLAID_ENV,
            PLAID_PRODUCTS: PLAID_PRODUCTS,
            PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
            PLAID_OAUTH_NONCE: PLAID_OAUTH_NONCE,
        });
    } catch (error) {
        console.error(error);
        response.render('error.ejs', {
            error,
        });
    } finally {
        console.log('clean session');
        delete request.session;
    }
});

// This is an endpoint defined for the OAuth flow to redirect to.
app.get('/oauth-response.html', async (request, response, next) => {
    try {
        const { referenceId, paymentToken } = request.session;
        console.log('req', request.session);

        // udpate Zoho Status
        await updatePaymentInZhoho({status: 'confirmed'}, referenceId);

        response.render('confirm-payment.ejs', {
            PLAID_PUBLIC_KEY: PLAID_PUBLIC_KEY,
            PLAID_ENV: PLAID_ENV,
            PLAID_PRODUCTS: PLAID_PRODUCTS,
            PLAID_COUNTRY_CODES: PLAID_COUNTRY_CODES,
            PLAID_OAUTH_NONCE: PLAID_OAUTH_NONCE,
            PLAID_OAUTH_REDIRECT_URI: PLAID_OAUTH_REDIRECT_URI,
            paymentToken,
        });
    } catch (error) {
        console.error(error);
        response.render('error.ejs', {
            error,
        });
    } finally {
        console.log('clean session');
        delete request.session;
    }
});

// Exchange token flow - exchange a Link public_token for
// an API access_token
// https://plaid.com/docs/#exchange-token-flow
app.post('/get_access_token', (request, response, next) => {
    PUBLIC_TOKEN = request.body.public_token;
    client.exchangePublicToken(PUBLIC_TOKEN, (error, tokenResponse) => {
        if (error != null) {
            prettyPrintResponse(error);
            return response.json({
                error: error,
            });
        }
        ACCESS_TOKEN = tokenResponse.access_token;
        ITEM_ID = tokenResponse.item_id;
        prettyPrintResponse(tokenResponse);
        response.json({
            access_token: ACCESS_TOKEN,
            item_id: ITEM_ID,
            error: null,
        });
    });
});

// Retrieve Identity for an Item
// https://plaid.com/docs/#identity
app.get('/identity', (request, response, next) => {
    client.getIdentity(ACCESS_TOKEN, (error, identityResponse) => {
        if (error != null) {
            prettyPrintResponse(error);
            return response.json({
                error: error,
            });
        }
        prettyPrintResponse(identityResponse);
        response.json({error: null, identity: identityResponse});
    });
});

// Retrieve ACH or ETF Auth data for an Item's accounts
// https://plaid.com/docs/#auth
app.get('/auth', (request, response, next) => {
    client.getAuth(ACCESS_TOKEN, (error, authResponse) => {
        if (error != null) {
            prettyPrintResponse(error);
            return response.json({
                error: error,
            });
        }
        prettyPrintResponse(authResponse);
        response.json({error: null, auth: authResponse});
    });
});

// This functionality is only relevant for the UK Payment Initiation product.
// Retrieve Payment for a specified Payment ID
app.get('/payment_get', (request, response, next) => {
    client.getPayment(PAYMENT_ID, (error, paymentGetResponse) => {
        if (error != null) {
            prettyPrintResponse(error);
            return response.json({
                error: error,
            });
        }
        prettyPrintResponse(paymentGetResponse);
        response.json({error: null, payment: paymentGetResponse});
    });
});

app.listen(APP_PORT, () => {
    console.log(`plaid-quickstart server listening on port ${APP_PORT}`);
});

const prettyPrintResponse = response => {
    console.log(util.inspect(response, {colors: true, depth: 4}));
};

app.post('/set_access_token', (request, response, next) => {
    ACCESS_TOKEN = request.body.access_token;
    client.getItem(ACCESS_TOKEN, (error, itemResponse) => {
        response.json({
            item_id: itemResponse.item.item_id,
            error: error,
        });
    });
});

// This functionality is only relevant for the UK Payment Initiation product.
// Sets the payment token in memory on the server side. We generate a new
// payment token so that the developer is not required to supply one.
// This makes the quickstart easier to use.
app.post('/set_payment_token', (request, response, next) => {
    client.createPaymentRecipient(
        'Harry Potter',
        'GB33BUKB20201555555555',
        {street: ['4 Privet Drive'], city: 'Little Whinging', postal_code: '11111', country: 'GB'},
    ).then((createPaymentRecipientResponse) => {
        const recipientId = createPaymentRecipientResponse.recipient_id;

        return client.createPayment(
            recipientId,
            'payment_ref',
            {currency: 'GBP', value: 12.34},
        ).then((createPaymentResponse) => {
            const paymentId = createPaymentResponse.payment_id;

            return client.createPaymentToken(
                paymentId,
            ).then((createPaymentTokenResponse) => {
                const paymentToken = createPaymentTokenResponse.payment_token;
                // PAYMENT_TOKEN = paymentToken;
                PAYMENT_ID = paymentId;
                return response.json({error: null, paymentToken: paymentToken});
            });
        });
    }).catch((error) => {
        prettyPrintResponse(error);
        return response.json({ error: error });
    });
});

// This functionality is only relevant for the UK Payment Initiation product.
// Sets the payment token in memory on the server side. We generate a new
// payment token so that the developer is not required to supply one.
// This makes the quickstart easier to use.
app.post('/payment_recipient', async (request, response, next) => {
    // eslint-disable-next-line camelcase
    const {name, iban, address: { street, city, postal_code, country }} = request.body;
    try {
        const recipient = await client.createPaymentRecipient(name, iban, {street, city, postal_code, country});
        prettyPrintResponse(recipient);
        return response.json({error: null, recipient});
    } catch (error) {
        prettyPrintResponse(error);
        return response.json({ error: error });
    }
});

// This functionality is only relevant for the UK Payment Initiation product.
// Sets the payment token in memory on the server side. We generate a new
// payment token so that the developer is not required to supply one.
// This makes the quickstart easier to use.
app.get('/recipients', (request, response, next) => {
    if (PLAID_ENV !== 'sandbox') {
        return response.res.status(404).json('I dont have that');
    }

    client.listPaymentRecipients((error, recipients) => {
        if (error) {
            prettyPrintResponse(error);
            return response.json({ error: error });
        }
        prettyPrintResponse(recipients);
        return response.json({error: null, recipients});
    });
});

const parseZohoResponse = (xml) => {
    const { response: { records: { record: { column: zohoValues } } } } = convertXml.xml2js(xml, {compact: true});
    const informations = {};
    zohoValues.forEach((item) => {
        informations[item._attributes.name] = item.value._cdata;
    });
    console.log(JSON.stringify(informations, null, 2));
    return informations;
};

const updatePaymentInZhoho = async (values, referenceId) => {
    const qsToUpdate = querystring.stringify(values);
    const uri = `https://creator.zoho.com/api/mboecasse1/xml/pardna-v3/form/Payment_Initiation/record/update?${qsToUpdate}&criteria=reference_id%3D%22${referenceId}%22&authtoken=${ZOHO_ACCESS_TOKEN}`;
    console.log('POST : ', uri);
    const res = await rp({method: 'POST', uri});
    const jsonResponse = convertXml.xml2js(res, {compact: true});
    console.log(JSON.stringify(jsonResponse, null, 2));
    return jsonResponse;
};

// This functionality is only relevant for the UK Payment Initiation product.
// Sets the payment token in memory on the server side. We generate a new
// payment token so that the developer is not required to supply one.
// This makes the quickstart easier to use.
app.post('/init_payment', async (request, response, next) => {
    try {
        const {transacId} = request.body;
        prettyPrintResponse(transacId);

        const getTransactionsInformationUrl = `https://creator.zoho.com/api/xml/pardna-v3/view/All_Payment_Initiations?authtoken=${ZOHO_ACCESS_TOKEN}&criteria=reference_id%3D%3D%22${transacId}%22`;
        // fetch from zoho all information for transcation
        const res = await rp(getTransactionsInformationUrl);
        const {currency, amount: value, reference_id: referenceId, recipient_id: recipientId, status} = parseZohoResponse(res);

        // TODO attention à la gestion des erreurs.
        // Ll ne faut pas permettre de payer N fois juste en faisant F5
        if (status !== 'payment_pending') {
            throw new Error('Already Confirmed');
        }

        // const recipientId = 'recipient-id-sandbox-01fc76e7-23ba-4d02-9a2e-2dadad2bcb85';
        const { payment_id: paymentId } = await client.createPayment(
            recipientId,
            referenceId,
            {currency, value: parseFloat(value)},
        );
        prettyPrintResponse(paymentId);
        const { payment_token: paymentToken } = await client.createPaymentToken(paymentId);

        // save zoho_reference_id in session to finalize payment later
        request.session.referenceId = referenceId;
        request.session.paymentToken = paymentToken;
        request.session.paymentId = paymentId;

        return response.json({error: null, paymentToken});
    } catch (errorhandler) {
        prettyPrintResponse(errorhandler);
        return response.json({ error: errorhandler });
    }
});

app.post('/update_payment', async (request, response, next) => {
    try {
        const { referenceId } = request.session;
        const { eventName, errorCode } = request.body;
        prettyPrintResponse(request.body);

        if (eventName === 'ERROR' || errorCode) {
            // udpate Zoho Status
            await updatePaymentInZhoho({status: 'error'}, referenceId);
        }

        return response.json({ error: null });
    } catch (errorhandler) {
        prettyPrintResponse(errorhandler);
        return response.json({ error: errorhandler });
    }
});

app.post('/finish_payment', async (request, response, next) => {
    try {
        const { referenceId } = request.session;
        const { public_token: publicToken, metadata } = request.body;
        prettyPrintResponse(publicToken, metadata);

        const { access_token: accessToken } = await client.exchangePublicToken(publicToken);
        request.session.accessToken = accessToken;

        // udpate Zoho Status
        await updatePaymentInZhoho({status: 'confirmed'}, referenceId);
        return response.json({ error: null, accessToken });
    } catch (errorhandler) {
        prettyPrintResponse(errorhandler);
        return response.json({ error: errorhandler });
    }
});

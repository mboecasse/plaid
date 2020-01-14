### plaid-node quickstart

[Quickstart guide](https://plaid.com/docs/quickstart)

``` bash
git clone https://github.com/plaid/quickstart.git
cd quickstart/node
npm install

# Start the Quickstart with your API keys from the Dashboard
# https://dashboard.plaid.com/account/keys
#
# PLAID_PRODUCTS is a comma-separated list of products to use when initializing
# Link. Note that this list must contain 'assets' in order for the app to be
# able to create and retrieve asset reports.
APP_PORT=8000 \
PLAID_CLIENT_ID=5e1dacfe8fc32f0012966daf \
PLAID_SECRET=11cc4747376f036d50da62ce3bdaec \
PLAID_PUBLIC_KEY=485c4ad6f9dbebf69392a7d634dc31 \
PLAID_PRODUCTS=transactions \
PLAID_COUNTRY_CODES=US,CA,GB,FR,ES,IE \
PLAID_ENV=sandbox \
node index.js
# Go to http://localhost:8000
```

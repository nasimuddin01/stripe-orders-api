const stripe = require("stripe")(token, {
  apiVersion: "2020-08-27; orders_beta=v2",
});

const createProduct = async ({
  orderType,
  stripeConnectedAccountId,
  orderId,
}) => {
  const product = await stripe.products.create({
    name: orderType,
    metadata: {
      stripeConnectedAccountId,
      orderId,
    },
  });
  return product;
};

const createPrice = async (amount, productId) => {
  const price = await stripe.prices.create({
    unit_amount: Number(amount * 100),
    currency: "gbp",
    product: productId,
    tax_behavior: "exclusive",
  });
  return price;
};

const createOrder = async ({ productId, stripeCustomerId, email, ip }) => {
  const order = await stripe.orders.create({
    line_items: [{ product: productId, quantity: 1 }],
    currency: "gbp",
    payment: {
      settings: {
        payment_method_types: ["card"],
      },
    },
    customer: stripeCustomerId,
    ip_address: ip,
    automatic_tax: {
      enabled: true,
    },
    billing_details: { email },
    expand: ["line_items"],
  });
  return order;
};

module.exports.createOrderAndCharge = functions
  .region("europe-west1")
  .https.onRequest((req, res) => {
    return cors()(req, res, async () => {
      try {
        const {
          amount,
          stripeConnectedAccountId,
          email,
          orderId,
          orderType,
          stripeCustomerId,
          ip,
        } = req.body;
        const customer = await stripe.customers.retrieve(stripeCustomerId);
        let product = await createProduct({
          orderType,
          stripeConnectedAccountId,
          orderId,
        });
        const price = await createPrice(amount, newProduct.id);
        product = await stripe.products.update(product.id, {
          price: price.id,
        });
        const order = await createOrder({
          productId: product.id,
          stripeCustomerId,
          email,
          ip,
          stripeConnectedAccountId,
          paymentMethodId: customer.invoice_settings.default_payment_method,
        });
        const resource = stripe.StripeResource.extend({
          request: stripe.StripeResource.method({
            method: "POST",
            path: `orders/${order.id}/submit`,
          }),
        });
        new resource(stripe).request(
          {
            expected_total: order.amount_total,
            expand: ["payment.payment_intent"],
          },
          async (err, response) => {
            if (err) throw err;
            const paymentIntent = await stripe.paymentIntents.confirm(
              response.payment.payment_intent.id,
              {
                payment_method:
                  customer.invoice_settings.default_payment_method,
                off_session: true,
              }
            );
            res.status(200).send({
              message: "Order created successfully",
              paymentIntent,
            });
          }
        );
      } catch (e) {
        res.status(500).send({ message: e.message });
      }
    });
  });

const stripePlanCreate = async (amount, userId, stripeAccount) => {
  const plan = await stripe.plans.create(
    {
      amount: Number(amount * 100),
      currency: "gbp",
      interval: "month",
      product: {
        name: "Standard",
      },
      metadata: {
        firebaseUID: userId,
      },
    },
    { stripeAccount }
  );
  return plan.id;
};

const createSubscription = async ({
  stripeCustomerId,
  planId,
  stripeConnectedAccountId,
}) => {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  const paymentMethod = await stripe.paymentMethods.create(
    {
      customer: stripeCustomerId,
      payment_method: customer.invoice_settings.default_payment_method,
    },
    { stripeAccount: stripeConnectedAccountId }
  );
  const connectedAccountCustomer = await stripe.customers.create(
    { payment_method: paymentMethod.id },
    { stripeAccount: stripeConnectedAccountId }
  );
  const subscription = await stripe.subscriptions.create(
    {
      customer: connectedAccountCustomer.id,
      items: [
        {
          price: planId,
        },
      ],
      expand: ["latest_invoice.payment_intent"],
      application_fee_percent: 15,
      metadata: {
        order_type: "subscription",
      },
    },
    {
      stripeAccount: stripeConnectedAccountId,
    }
  );
  return subscription;
};

module.exports.subscribe = functions
  .region("europe-west1")
  .https.onRequest((req, res) => {
    return cors()(req, res, async () => {
      const { stripeCustomerId, planId, stripeConnectedAccountId } = req.body;
      try {
        const subscription = await createSubscription({
          stripeCustomerId,
          planId,
          stripeConnectedAccountId,
        });
        res.status(200).send({
          message: "Subscribed successfully",
          subscription,
        });
      } catch (e) {
        res.status(500).send({ message: e.message });
      }
    });
  });

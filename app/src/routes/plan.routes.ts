import express from 'express';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { getRazorpayConfig } from '../services/payment-settings.service';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});

// Get all available plans (public — also consumed by the marketing site's pricing section)
router.get('/plans', async (req, res) => {
  try {
    const plans: any = await query(
      'SELECT id, name, description, price, billing_period, max_products, max_requests_per_month, features FROM plans WHERE is_active = TRUE ORDER BY price ASC'
    );

    let currency = 'USD';
    try { currency = (await getRazorpayConfig()).currency; } catch (_) { /* default */ }

    res.json({ plans, currency });
  } catch (error) {
    console.error('Plans fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Create checkout session for plan purchase
router.post('/checkout', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const { planId } = req.body;
    const tenantId = req.user.id;

    if (!planId) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }

    // Get plan details
    const plans: any = await query(
      'SELECT * FROM plans WHERE id = ? AND is_active = TRUE',
      [planId]
    );

    if (!plans || plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = plans[0];

    // Get tenant details
    const tenants: any = await query(
      'SELECT email, store_name FROM tenants WHERE id = ?',
      [tenantId]
    );

    if (!tenants || tenants.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = tenants[0];

    // Create or retrieve Stripe customer
    let customerId: string;
    const existing: any = await query(
      'SELECT stripe_customer_id FROM tenants WHERE id = ?',
      [tenantId]
    );

    if (existing[0]?.stripe_customer_id) {
      customerId = existing[0].stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: tenant.email,
        metadata: {
          tenant_id: tenantId.toString(),
          store_name: tenant.store_name
        }
      });
      customerId = customer.id;

      await query(
        'UPDATE tenants SET stripe_customer_id = ? WHERE id = ?',
        [customerId, tenantId]
      );
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
              description: plan.description
            },
            unit_amount: Math.round(plan.price * 100),
            recurring: {
              interval: plan.billing_period === 'yearly' ? 'year' : 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/plans`,
      metadata: {
        tenant_id: tenantId.toString(),
        plan_id: planId.toString()
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = parseInt(session.metadata?.tenant_id || '0');
        const planId = parseInt(session.metadata?.plan_id || '0');

        if (tenantId && planId) {
          // Get subscription details
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);

          // Create subscription record
          await query(
            `INSERT INTO subscriptions (tenant_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end)
             VALUES (?, ?, ?, 'active', FROM_UNIXTIME(?), FROM_UNIXTIME(?))`,
            [tenantId, planId, subscription.id, subscription.current_period_start, subscription.current_period_end]
          );

          // Update tenant status
          await query(
            'UPDATE tenants SET status = ?, plan_id = ? WHERE id = ?',
            ['active', planId, tenantId]
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;

        await query(
          `UPDATE subscriptions 
           SET status = ?, current_period_start = FROM_UNIXTIME(?), current_period_end = FROM_UNIXTIME(?)
           WHERE stripe_subscription_id = ?`,
          [subscription.status, subscription.current_period_start, subscription.current_period_end, subscription.id]
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await query(
          `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE stripe_subscription_id = ?`,
          [subscription.id]
        );

        // Update tenant status
        const subs: any = await query(
          'SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id = ?',
          [subscription.id]
        );

        if (subs && subs.length > 0) {
          await query(
            'UPDATE tenants SET status = ? WHERE id = ?',
            ['suspended', subs[0].tenant_id]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;

        if (invoice.subscription) {
          await query(
            `UPDATE subscriptions SET status = 'past_due' WHERE stripe_subscription_id = ?`,
            [invoice.subscription]
          );
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook handler failed' });
  }
});

// Get current subscription
router.get('/subscription', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const subscription: any = await query(
      `SELECT s.*, p.name as plan_name, p.price, p.billing_period, 
              p.max_products, p.max_requests_per_month, p.features
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = ? AND s.status = 'active'
       ORDER BY s.current_period_end DESC
       LIMIT 1`,
      [req.user.id]
    );

    if (!subscription || subscription.length === 0) {
      return res.json({ subscription: null });
    }

    res.json({ subscription: subscription[0] });
  } catch (error) {
    console.error('Subscription fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// Cancel subscription
router.post('/cancel-subscription', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const subscription: any = await query(
      `SELECT stripe_subscription_id FROM subscriptions 
       WHERE tenant_id = ? AND status = 'active' 
       ORDER BY current_period_end DESC LIMIT 1`,
      [req.user.id]
    );

    if (!subscription || subscription.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel at period end in Stripe
    await stripe.subscriptions.update(subscription[0].stripe_subscription_id, {
      cancel_at_period_end: true
    });

    res.json({ message: 'Subscription will be cancelled at the end of the billing period' });
  } catch (error) {
    console.error('Subscription cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Demo subscribe — assign a plan directly (no Stripe, placeholder for Task 7)
router.post('/demo-subscribe', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const { planId } = req.body;
    const tenantId = req.user.id;

    if (!planId) return res.status(400).json({ error: 'Plan ID is required' });

    const plans: any = await query('SELECT * FROM plans WHERE id = ? AND is_active = TRUE', [planId]);
    if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const plan = plans[0];

    // Upsert subscription — cancel old active ones first
    await query(
      "UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE tenant_id = ? AND status = 'active'",
      [tenantId]
    );

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (?, ?, 'active', NOW(), ?)`,
      [tenantId, planId, periodEnd]
    );

    // Update tenant status and plan
    await query(
      "UPDATE tenants SET status = 'active', plan_id = ? WHERE id = ?",
      [planId, tenantId]
    );

    res.json({
      message: `Successfully subscribed to ${plan.name}`,
      plan: { id: plan.id, name: plan.name, price: plan.price }
    });
  } catch (error) {
    console.error('Demo subscribe error:', error);
    res.status(500).json({ error: 'Failed to subscribe to plan' });
  }
});

// Get current month API usage + limits for logged-in tenant
router.get('/usage', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.user.id;

    // Current month usage
    const usageRows: any = await query(
      `SELECT SUM(request_count) AS used
       FROM api_usage
       WHERE tenant_id = ? AND date >= DATE_FORMAT(NOW(), '%Y-%m-01')
         AND endpoint IN ('/products/search', '/products/public/search')`,
      [tenantId]
    );
    const used = usageRows[0]?.used || 0;

    // Plan limits
    const subRows: any = await query(
      `SELECT p.max_requests_per_month, p.max_products, p.name AS plan_name
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = ? AND s.status = 'active'
       ORDER BY s.current_period_end DESC LIMIT 1`,
      [tenantId]
    );

    // Fall back to trial limits if no active subscription
    const limits = subRows.length > 0
      ? subRows[0]
      : { max_requests_per_month: 1000, max_products: 100, plan_name: 'Trial' };

    res.json({
      used,
      limit: limits.max_requests_per_month,
      maxProducts: limits.max_products,
      planName: limits.plan_name,
      percentage: limits.max_requests_per_month > 0
        ? Math.min(100, Math.round((used / limits.max_requests_per_month) * 100))
        : 0,
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

export default router;

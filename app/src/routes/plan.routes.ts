import express from 'express';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { getRazorpayConfig } from '../services/payment-settings.service';
import { ensurePaymentTables } from '../services/razorpay.service';
import { applyDuePlanChange } from './billing.routes';
import { expireEndedSubscriptions } from '../services/subscription-lifecycle.service';

const router = express.Router();

// Get all available plans (public — also consumed by the marketing site's pricing section)
router.get('/plans', async (req, res) => {
  try {
    await ensurePaymentTables();
    const plans: any = await query(
      'SELECT id, name, description, price, billing_period, max_products, max_requests_per_month, features, parent_plan_id, yearly_discount_percent FROM plans WHERE is_active = TRUE ORDER BY price ASC'
    );

    let currency = 'USD';
    try { currency = (await getRazorpayConfig()).currency; } catch (_) { /* default */ }

    res.json({ plans, currency });
  } catch (error) {
    console.error('Plans fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Get current subscription
router.get('/subscription', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    // Demo-mode subscriptions have no gateway to fire a renewal webhook — apply
    // any scheduled downgrade whose current_period_end has already passed.
    await applyDuePlanChange(req.user.id);
    // End subscriptions whose cancelled period is over before reporting state
    await expireEndedSubscriptions(req.user.id);

    // A paid subscription wins; otherwise a plan scheduled to start when the
    // free trial ends ('trialing'), otherwise one paused after failed payments
    // ('past_due' — no access, shown so the merchant knows why and can
    // resubscribe). Access checks elsewhere deliberately exclude past_due.
    const subscription: any = await query(
      `SELECT s.*, p.name as plan_name, p.price, p.billing_period,
              p.max_products, p.max_requests_per_month, p.features,
              pp.name AS pending_plan_name, pp.price AS pending_plan_price, pp.billing_period AS pending_plan_billing_period
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       LEFT JOIN plans pp ON s.pending_plan_id = pp.id
       WHERE s.tenant_id = ? AND s.status IN ('active', 'trialing', 'past_due')
       ORDER BY FIELD(s.status, 'active', 'trialing', 'past_due'), s.current_period_end DESC, s.id DESC
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

// Get current month API usage + limits for logged-in tenant
router.get('/usage', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.user.id;

    // Same reconciliation as /subscription — keeps demo-mode limits correct once a
    // scheduled downgrade's renewal date has passed.
    await applyDuePlanChange(tenantId);
    await expireEndedSubscriptions(tenantId);

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

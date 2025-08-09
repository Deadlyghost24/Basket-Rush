import Order from '../models/orderModel.js';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Create a new order
export const createOrder = async (req, res) => {
    try {
        const { customer, items, paymentMethod, notes, deliveryDate } = req.body;
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ message: 'Invalid or empty items array' });
        }

        const normalizedPM =
            paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online Payment';

        const orderItems = items.map(i => ({
            id: i.id,
            name: i.name,
            price: Number(i.price),
            quantity: Number(i.quantity),
            imageUrl: i.imageUrl
        }));

        const orderId = `ORD-${uuidv4()}`;
        let newOrder;

        if (normalizedPM === 'Online Payment') {
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'payment',
                line_items: orderItems.map(o => ({
                    price_data: {
                        currency: 'inr',
                        product_data: { name: o.name },
                        unit_amount: Math.round(o.price * 100)
                    },
                    quantity: o.quantity
                })),
                customer_email: customer.email,
                success_url: `${process.env.FRONTEND_URL}/myorders/verify?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.FRONTEND_URL}/checkout?payment_status=cancel`,
                metadata: { orderId }
            });

            newOrder = new Order({
                orderId,
                user: req.user._id,
                customer,
                items: orderItems,
                shipping: 0,
                paymentMethod: normalizedPM,
                paymentStatus: 'Unpaid',
                sessionId: session.id,
                paymentIntentId: session.payment_intent,
                notes,
                deliveryDate
            });

            await newOrder.save();
            return res.status(201).json({ order: newOrder, checkoutUrl: session.url });
        }

        // Cash on Delivery
        newOrder = new Order({
            orderId,
            user: req.user._id,
            customer,
            items: orderItems,
            shipping: 0,
            paymentMethod: normalizedPM,
            paymentStatus: 'Paid',
            notes,
            deliveryDate
        });

        await newOrder.save();
        res.status(201).json({ order: newOrder, checkoutUrl: null });
    } catch (err) {
        console.error('createOrder error:', err);
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
};

// Confirm Stripe payment
export const confirmPayment = async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) return res.status(400).json({ message: 'session_id required' });

        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== 'paid') {
            return res.status(400).json({ message: 'Payment not completed' });
        }

        const order = await Order.findOneAndUpdate(
            { sessionId: session_id },
            { paymentStatus: 'Paid' },
            { new: true }
        );
        if (!order) return res.status(404).json({ message: 'Order not found' });

        res.json(order);
    } catch (err) {
        console.error('confirmPayment error:', err);
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// GET /api/orders  — public, returns all orders
export const getOrders = async (req, res, next) => {
    try {
        const orders = await Order.find({})
            .sort({ createdAt: -1 })
            .lean();
        res.json(orders);
    } catch (err) {
        console.error('getOrders error:', err);
        next(err);
    }
};

// GET /api/orders/:id  — public, returns one order
export const getOrderById = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id).lean();
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (err) {
        console.error('getOrderById error:', err);
        next(err);
    }
};

// PUT /api/orders/:id  — public, updates allowed fields
export const updateOrder = async (req, res, next) => {
    try {
        const allowed = ['status', 'paymentStatus', 'deliveryDate', 'notes'];
        const updateData = {};
        allowed.forEach(field => {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field];
            }
        });

        const updated = await Order.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(updated);
    } catch (err) {
        console.error('updateOrder error:', err);
        next(err);
    }
};

// DELETE /api/orders/:id  — public, deletes the order
export const deleteOrder = async (req, res, next) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id).lean();
        if (!deleted) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json({ message: 'Order deleted successfully' });
    } catch (err) {
        console.error('deleteOrder error:', err);
        next(err);
    }
};
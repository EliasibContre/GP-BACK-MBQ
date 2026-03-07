// src/controllers/paymentPlan.controller.js
import { prisma } from "../config/prisma.js";

export const createPaymentPlan = async (req, res) => {

    const {
        purchaseOrderId,
        totalAmount,
        installments,
        startDate,
        frequency = "MONTHLY"
    } = req.body;

    if (!purchaseOrderId || !totalAmount || !installments) {
        return res.status(400).json({
            message: "Datos incompletos"
        });
    }

    const amountPerInstallment = Number(totalAmount) / Number(installments);

    const payments = [];

    for (let i = 1; i <= installments; i++) {

        const date = new Date(startDate);

        if (frequency === "MONTHLY") {
            date.setMonth(date.getMonth() + (i - 1));
        }

        const payment = await prisma.payment.create({
            data: {
                purchaseOrderId,
                amount: amountPerInstallment,
                installmentNo: i,
                installmentOf: installments,
                paidAt: date,
                method: "TRANSFER",
                status: "PENDING",
                isScheduled: true
            }
        });

        payments.push(payment);
    }

    res.json({
        message: "Plan de pagos creado",
        payments
    });
};
// src/controllers/paymentPlan.controller.js
import { prisma } from "../config/prisma.js";

export const createPaymentPlan = async (req, res) => {
    try {
        const {
            purchaseOrderId,
            totalAmount,
            installments,
            startDate,
            closeDate,
            frequency = "MONTHLY",
        } = req.body;

        if (!purchaseOrderId || !totalAmount || !installments || !startDate) {
            return res.status(400).json({
                message:
                    "Faltan datos requeridos: purchaseOrderId, totalAmount, installments y startDate",
            });
        }

        const parsedPurchaseOrderId = Number(purchaseOrderId);
        const parsedTotalAmount = Number(totalAmount);
        const parsedInstallments = Number(installments);

        if (
            !Number.isFinite(parsedPurchaseOrderId) ||
            !Number.isFinite(parsedTotalAmount) ||
            !Number.isFinite(parsedInstallments) ||
            parsedInstallments <= 0
        ) {
            return res.status(400).json({
                message: "Datos inválidos para crear el plan de pagos",
            });
        }

        const amountPerInstallment = parsedTotalAmount / parsedInstallments;
        const payments = [];

        for (let i = 1; i <= parsedInstallments; i++) {
            const paymentDate = new Date(startDate);
            if (Number.isNaN(paymentDate.getTime())) {
                return res.status(400).json({
                    message: "startDate inválida",
                });
            }

            if (frequency === "MONTHLY") {
                paymentDate.setMonth(paymentDate.getMonth() + (i - 1));
            }

            let paymentCloseDate = null;

            if (closeDate) {
                paymentCloseDate = new Date(closeDate);

                if (Number.isNaN(paymentCloseDate.getTime())) {
                    return res.status(400).json({
                        message: "closeDate inválida",
                    });
                }

                if (frequency === "MONTHLY") {
                    paymentCloseDate.setMonth(paymentCloseDate.getMonth() + (i - 1));
                }
            }

            const payment = await prisma.payment.create({
                data: {
                    purchaseOrderId: parsedPurchaseOrderId,
                    amount: amountPerInstallment,
                    installmentNo: i,
                    installmentOf: parsedInstallments,
                    paidAt: paymentDate,
                    closeAt: paymentCloseDate,
                    method: "TRANSFER",
                    status: "PENDING",
                    isScheduled: true,
                },
            });

            payments.push(payment);
        }

        return res.json({
            message: "Plan de pagos creado",
            payments,
        });
    } catch (error) {
        console.error("Error createPaymentPlan:", error);
        return res.status(500).json({
            message: "Error al crear el plan de pagos",
            detail: error.message,
        });
    }
};
const express = require("express");
const pool = require("../config/db");
const { requiereSesion } = require("../middleware/auth");

const router = express.Router();
router.use(requiereSesion);

/**
 * Canjea un cupón.
 *
 * Todo ocurre dentro de una transacción con el cupón bloqueado. Sin ese
 * bloqueo, dos personas canjeando el último uso en el mismo segundo lo
 * usarían las dos: ambas leerían "usos = 0" antes de que ninguna
 * escribiera. Es raro, y pasa justo el día que se comparte el código en
 * un grupo.
 */
router.post("/canjear", async (req, res) => {
    const codigo = String((req.body || {}).codigo || "").trim().toUpperCase();
    if (codigo.length < 4) return res.status(400).json({ message: "Escribí el código." });

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        const c = await cliente.query(
            "SELECT * FROM cupones WHERE codigo = $1 FOR UPDATE", [codigo]
        );
        if (c.rowCount === 0) {
            await cliente.query("ROLLBACK");
            // Mismo mensaje para "no existe" y "vencido": decir cuál de
            // los dos es le diría a cualquiera qué códigos existen, y
            // probar códigos hasta acertar es trivial.
            return res.status(404).json({ message: "Ese código no es válido." });
        }

        const cup = c.rows[0];
        const vencido = cup.vence && new Date(cup.vence) < new Date();
        const agotado = cup.usos_max !== null && cup.usos >= cup.usos_max;

        if (!cup.activo || vencido) {
            await cliente.query("ROLLBACK");
            return res.status(404).json({ message: "Ese código no es válido." });
        }
        if (agotado) {
            await cliente.query("ROLLBACK");
            return res.status(409).json({ message: "Ese código ya se usó todas las veces que podía." });
        }

        const yaLoUso = await cliente.query(
            "SELECT 1 FROM canjes WHERE codigo = $1 AND usuario_id = $2",
            [codigo, req.usuario.id]
        );
        if (yaLoUso.rowCount > 0) {
            await cliente.query("ROLLBACK");
            return res.status(409).json({ message: "Ya usaste este código." });
        }

        // El plan se SUMA a lo que quede, no lo reemplaza. Quien tiene
        // dos semanas pagadas y canjea un mes no debería perder esas dos
        // semanas por haber canjeado en mal momento.
        const u = await cliente.query(
            `UPDATE usuarios
                SET plan = $2,
                    -- plan_vence es DATE. Sin el cast a date, mezclar
                    -- con NOW() (que es timestamptz) hace fallar el
                    -- GREATEST por tipos incompatibles.
                    plan_vence = (GREATEST(COALESCE(plan_vence, CURRENT_DATE), CURRENT_DATE)
                                 + ($3 || ' months')::interval)::date
              WHERE id = $1
              RETURNING plan, plan_vence`,
            [req.usuario.id, cup.plan, String(cup.meses)]
        );

        await cliente.query(
            "INSERT INTO canjes (codigo, usuario_id) VALUES ($1,$2)",
            [codigo, req.usuario.id]
        );
        await cliente.query(
            "UPDATE cupones SET usos = usos + 1 WHERE codigo = $1", [codigo]
        );

        await cliente.query("COMMIT");

        res.json({
            ok: true, plan: u.rows[0].plan, vence: u.rows[0].plan_vence,
            meses: cup.meses,
            mensaje: `Listo. Tenés ${cup.meses} ${cup.meses === 1 ? "mes" : "meses"} de acceso completo.`
        });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[CUPONES] canjear:", err.message);
        res.status(500).json({ message: "No se pudo canjear el código." });
    } finally {
        cliente.release();
    }
});

/** Estado del plan de quien está dentro. */
router.get("/mi-plan", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT plan, plan_vence,
                    (plan_vence IS NOT NULL AND plan_vence >= CURRENT_DATE) vigente,
                    GREATEST(0, (plan_vence - CURRENT_DATE)) dias_restantes
               FROM usuarios WHERE id = $1`, [req.usuario.id]
        );
        res.json(r.rows[0] || {});
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer tu plan." });
    }
});

module.exports = router;

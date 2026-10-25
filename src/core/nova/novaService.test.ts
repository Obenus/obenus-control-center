/**
 * Pruebas unitarias del módulo NOVA (sin SSH real ni Telegram real).
 * Ejecutar: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { compareAgentHash, parseAgentMeta, validateAgentContent } from "./agentPackage";
import { redactSecrets } from "../../lib/novaConfig";
import { statusLabel } from "./statusLabel";

const agentPath = path.join(process.cwd(), "obenus-nova.py");

describe("agentPackage", () => {
    it("valida y calcula SHA-256 del agente en disco", () => {
        const content = fs.readFileSync(agentPath);
        const meta = parseAgentMeta(content);
        assert.ok(meta.version);
        assert.equal(meta.sha256.length, 64);
        const expected = crypto.createHash("sha256").update(content).digest("hex");
        assert.equal(meta.sha256, expected);
        const v = validateAgentContent(content);
        assert.equal(v.ok, true);
    });

    it("rechaza contenido inválido", () => {
        const bad = validateAgentContent(Buffer.from("print('hi')\n"));
        assert.equal(bad.ok, false);
    });

    it("detecta hash idéntico (servidor actualizado)", () => {
        const content = fs.readFileSync(agentPath);
        const { sha256 } = parseAgentMeta(content);
        assert.equal(compareAgentHash(sha256, sha256), true);
    });

    it("detecta hash distinto (versión antigua)", () => {
        const content = fs.readFileSync(agentPath);
        const { sha256 } = parseAgentMeta(content);
        assert.equal(compareAgentHash("0".repeat(64), sha256), false);
    });

    it("trata ausencia de hash como no instalado", () => {
        const content = fs.readFileSync(agentPath);
        const { sha256 } = parseAgentMeta(content);
        assert.equal(compareAgentHash(null, sha256), false);
        assert.equal(compareAgentHash(undefined, sha256), false);
    });
});

describe("redactSecrets", () => {
    it("oculta tokens y secretos explícitos", () => {
        const token = "1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const secret = "super-secret-value";
        const out = redactSecrets(`Error con ${token} y secret=${secret}`, [token, secret]);
        assert.equal(out.includes(token), false);
        assert.equal(out.includes(secret), false);
        assert.ok(out.includes("[REDACTED"));
    });
});

describe("statusLabel", () => {
    it("traduce estados de instalación", () => {
        assert.equal(statusLabel("NOT_INSTALLED"), "No instalado");
        assert.equal(statusLabel("INSTALLED"), "Instalado y actualizado");
        assert.equal(statusLabel("UPDATE_AVAILABLE"), "Actualización disponible");
        assert.equal(statusLabel("CONNECTION_ERROR"), "Error de conexión");
        assert.equal(statusLabel("INSTALL_ERROR"), "Error de instalación");
    });
});

describe("escenarios lógicos multi-servidor", () => {
    it("jobId de schedule debe incluir serverId para evitar colisión BullMQ", () => {
        const serverA = "srv-aaa";
        const serverB = "srv-bbb";
        const task = "Apt_Update";
        const idA = `sched_${serverA}_${task}`;
        const idB = `sched_${serverB}_${task}`;
        assert.notEqual(idA, idB);
    });

    it("simula decisión de actualización por SHA", () => {
        const official = "abc123";
        const cases = [
            { installed: null as string | null, expectUpdate: true, name: "sin NOVA" },
            { installed: official, expectUpdate: false, name: "actualizado" },
            { installed: "oldhash", expectUpdate: true, name: "versión antigua" },
        ];
        for (const c of cases) {
            const needs = !c.installed || c.installed !== official;
            assert.equal(needs, c.expectUpdate, c.name);
        }
    });
});

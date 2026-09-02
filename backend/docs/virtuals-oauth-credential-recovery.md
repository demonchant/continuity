# Virtuals discovery OAuth credential recovery

Continuity uses OAuth only for read-only Virtuals agent discovery. The Render environment values are bootstrap or deliberate recovery inputs. Once the database row exists, the encrypted PostgreSQL value is authoritative and environment values cannot overwrite it.

The credential envelope uses AES-256-GCM. `VIRTUALS_DISCOVERY_CREDENTIAL_KEY` is a canonical base64 encoding of exactly 32 random bytes. Keep it in Render only. It is not stored in PostgreSQL and must be backed up in an approved secret manager.

## Recovery

Use this only when the durable row cannot be decrypted or the refresh token is unusable:

1. Suspend the Continuity service so the running process cannot refresh credentials during recovery.
2. Run the official ACP CLI OAuth configure flow on an authorized workstation.
3. Securely replace both Render bootstrap variables without printing their values.
4. If the encryption key was lost or compromised, generate and install a new `VIRTUALS_DISCOVERY_CREDENTIAL_KEY`. Otherwise retain the existing key.
5. Run the reset command once in a Render shell or one-off administrative process with `DATABASE_URL` available:

   ```sh
   VIRTUALS_DISCOVERY_CREDENTIAL_RESET_CONFIRM=RESET_VIRTUALS_DISCOVERY_CREDENTIALS npm run virtuals:discovery-credentials:reset
   ```

6. Remove the confirmation variable if it was configured persistently. Deploy or resume exactly one instance. Startup creates a new encrypted row from the updated bootstrap pair.
7. Perform read-only discovery. Do not create or fund a job as part of credential recovery.

The reset command deletes only the singleton Virtuals discovery credential row. It never reads or prints OAuth credentials. Do not manually edit PostgreSQL ciphertext fields.

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { marketInput, type MarketInput } from "@zyro/shared";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { PageHeading } from "../../components/shell";
import { Button } from "../../components/ui/button";
import { api } from "../../components/data";
export default function Create() {
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MarketInput>({
    resolver: zodResolver(marketInput),
    defaultValues: { category: "Zcash", stake: 10000000 },
  });
  const submit = handleSubmit(async (values) => {
    setError("");
    try {
      const m = await api("/markets", values);
      router.push("/markets/" + m.id);
    } catch (e) {
      setError((e as Error).message);
    }
  });
  const field = (name: keyof MarketInput, label: string, type = "text") => (
    <div className="field">
      <label htmlFor={name}>{label} *</label>
      <input
        id={name}
        type={type}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? name + "-error" : undefined}
        {...register(
          name,
          name === "stake"
            ? { valueAsNumber: true }
            : type === "datetime-local"
              ? { setValueAs: (v) => (v ? new Date(v).toISOString() : "") }
              : undefined,
        )}
      />
      {errors[name] && (
        <small id={name + "-error"} className="field-error">
          {errors[name]?.message}
        </small>
      )}
    </div>
  );
  return (
    <>
      <PageHeading
        eyebrow="TWO SIDES. ONE CLEAR AGREEMENT."
        title="Make a challenge."
        description="A good prediction starts with a precise question and unambiguous rules."
      />
      <div className="form-layout">
        <form className="panel" onSubmit={submit}>
          <h2>Challenge details</h2>
          {field("question", "YES/NO question")}
          <div className="field">
            <label htmlFor="description">Description *</label>
            <textarea
              id="description"
              {...register("description")}
              aria-invalid={!!errors.description}
            />
            {errors.description && (
              <small className="field-error">
                {errors.description.message}
              </small>
            )}
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="category">Category *</label>
              <select id="category" {...register("category")}>
                {["Zcash", "Technology", "Science", "Culture"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            {field("stake", "Stake per side (integer zatoshis)")}
            {field(
              "fundingDeadline",
              "Join before (your local time)",
              "datetime-local",
            )}
            {field(
              "resolutionDeadline",
              "Resolve after (your local time)",
              "datetime-local",
            )}
          </div>
          <small className="muted">
            100,000,000 zatoshis = 1 testnet TAZ. Minimum 10,000. No funds are
            collected.
          </small>
          <h2 style={{ marginTop: 28 }}>Make resolution verifiable</h2>
          {field("source", "Official HTTPS resolution source", "url")}
          <div className="field">
            <label htmlFor="rules">Resolution rules *</label>
            <textarea
              id="rules"
              placeholder="Define exactly what counts as YES, what counts as NO, and what happens if the source is unavailable."
              {...register("rules")}
              aria-invalid={!!errors.rules}
            />
            {errors.rules && (
              <small className="field-error">{errors.rules.message}</small>
            )}
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Creating challenge…" : "Create challenge"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <aside>
          <div className="panel">
            <ShieldCheck className="green" />
            <h3 style={{ marginTop: 20 }}>Clear terms. Shared conviction.</h3>
            <p className="muted">
              Each challenge creates a versioned, canonical agreement with a
              SHA-256 commitment. Participants explicitly sign the same terms
              and their chosen side.
            </p>
            <dl className="details-list">
              <div>
                <dt>Participants</dt>
                <dd>2 · YES vs NO</dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Planned network fee</dt>
                <dd>10,000 zatoshis</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd className="green">Zcash testnet</dd>
              </div>
            </dl>
          </div>
          <div className="notice">
            Creating or joining records an off-chain agreement. Funding, wallet
            signatures, outcome oracles and FROST escrow are not connected. No
            TAZ is moved.
          </div>
        </aside>
      </div>
    </>
  );
}

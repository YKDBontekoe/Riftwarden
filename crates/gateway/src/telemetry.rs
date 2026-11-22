//! Tracing + OpenTelemetry. Logs always go to stdout (JSON in production); when
//! `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans, logs and metrics are also exported over OTLP/gRPC to the
//! collector, which stores them in ClickHouse (docs/architecture-v2.md section 10).

use anyhow::Result;
use opentelemetry::{KeyValue, global, trace::TracerProvider as _};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, MetricExporter, SpanExporter, WithExportConfig};
use opentelemetry_sdk::{Resource, logs::SdkLoggerProvider, metrics::SdkMeterProvider, trace::SdkTracerProvider};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

const SERVICE: &str = "riftwarden-gateway";

/// Keeps the OTLP providers alive; `shutdown` flushes them on exit.
#[derive(Default)]
pub struct Telemetry {
    providers: Option<(SdkTracerProvider, SdkLoggerProvider, SdkMeterProvider)>,
}

impl Telemetry {
    pub fn init(json: bool, build: &str) -> Result<Self> {
        let filter = || EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,h2=warn,tonic=warn"));
        let stdout = if json {
            tracing_subscriber::fmt::layer().json().flatten_event(true).with_filter(filter()).boxed()
        } else {
            tracing_subscriber::fmt::layer().with_filter(filter()).boxed()
        };

        let Some(endpoint) = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok().filter(|v| !v.is_empty()) else {
            tracing_subscriber::registry().with(stdout).init();
            return Ok(Self::default());
        };

        let resource =
            Resource::builder().with_service_name(SERVICE).with_attribute(KeyValue::new("service.version", build.to_owned())).build();
        let tracer_provider = SdkTracerProvider::builder()
            .with_batch_exporter(SpanExporter::builder().with_tonic().with_endpoint(&endpoint).build()?)
            .with_resource(resource.clone())
            .build();
        let logger_provider = SdkLoggerProvider::builder()
            .with_batch_exporter(LogExporter::builder().with_tonic().with_endpoint(&endpoint).build()?)
            .with_resource(resource.clone())
            .build();
        let meter_provider = SdkMeterProvider::builder()
            .with_periodic_exporter(MetricExporter::builder().with_tonic().with_endpoint(&endpoint).build()?)
            .with_resource(resource)
            .build();
        global::set_meter_provider(meter_provider.clone());

        let spans = tracing_opentelemetry::layer().with_tracer(tracer_provider.tracer(SERVICE)).with_filter(filter());
        let logs = OpenTelemetryTracingBridge::new(&logger_provider).with_filter(filter());
        tracing_subscriber::registry().with(stdout).with(spans).with(logs).init();
        tracing::info!(%endpoint, "OTLP export enabled");
        Ok(Self { providers: Some((tracer_provider, logger_provider, meter_provider)) })
    }

    pub fn shutdown(self) {
        if let Some((t, l, m)) = self.providers {
            for r in [t.shutdown(), l.shutdown(), m.shutdown()] {
                if let Err(e) = r {
                    eprintln!("telemetry shutdown: {e}");
                }
            }
        }
    }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * MetricsService
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  // Dedicated Registry — avoids collisions with the global prom-client default
  // register when running multiple test suites in the same process.
  readonly registry = new Registry();

  // HTTP / infrastructure //
  private readonly httpRequestCounter: Counter<string>;
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpErrorCounter: Counter<string>;
  private readonly jobQueueSize: Gauge<string>;
  private readonly jobsProcessed: Counter<string>;
  private readonly jobsFailedCounter: Counter<string>;

  // Data-pipeline //
  private readonly articlesProcessedCounter: Counter<string>;
  private readonly sentimentGauge: Gauge<string>;
  private readonly modelInferenceHistogram: Histogram<string>;
  private readonly anomaliesDetectedCounter: Counter<string>;
  private readonly fetchErrorsCounter: Counter<string>;

  // Cache metrics //
  private readonly cacheHitsCounter: Counter<string>;
  private readonly cacheMissesCounter: Counter<string>;
  private readonly cacheFetchDuration: Histogram<string>;

  // Running totals for the rolling-average sentiment gauge
  private sentimentSum = 0;
  private sentimentCount = 0;

  // Escape-hatch maps for callers of the legacy getOrCreate* API
  private readonly customGauges = new Map<string, Gauge<string>>();
  private readonly customCounters = new Map<string, Counter<string>>();

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    // HTTP//
    this.httpRequestCounter = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpErrorCounter = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    // Job queue //
    this.jobQueueSize = new Gauge({
      name: 'job_queue_size',
      help: 'Current size of the job queue',
      labelNames: ['queue_name'] as const,
      registers: [this.registry],
    });

    this.jobsProcessed = new Counter({
      name: 'jobs_processed_total',
      help: 'Total number of jobs processed',
      labelNames: ['queue_name', 'status'] as const,
      registers: [this.registry],
    });

    this.jobsFailedCounter = new Counter({
      name: 'jobs_failed_total',
      help: 'Total number of failed jobs',
      labelNames: ['queue_name'] as const,
      registers: [this.registry],
    });

    // Data-pipeline //
    this.articlesProcessedCounter = new Counter({
      name: 'lumenpulse_articles_processed_total',
      help: 'Total crypto-news articles processed by the pipeline',
      labelNames: ['source', 'status'] as const,
      registers: [this.registry],
    });

    this.sentimentGauge = new Gauge({
      name: 'lumenpulse_sentiment_score',
      help: 'Rolling average sentiment score (-1 bearish → +1 bullish)',
      labelNames: ['source'] as const,
      registers: [this.registry],
    });

    this.modelInferenceHistogram = new Histogram({
      name: 'lumenpulse_model_inference_duration_seconds',
      help: 'Wall-clock latency of ML model inference calls',
      labelNames: ['model', 'task'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.anomaliesDetectedCounter = new Counter({
      name: 'lumenpulse_anomalies_detected_total',
      help: 'Price / sentiment anomalies flagged by the detection model',
      labelNames: ['type', 'severity'] as const,
      registers: [this.registry],
    });

    this.fetchErrorsCounter = new Counter({
      name: 'lumenpulse_fetch_errors_total',
      help: 'Errors encountered while fetching news from external sources',
      labelNames: ['source', 'error_code'] as const,
      registers: [this.registry],
    });

    // Cache metrics //
    this.cacheHitsCounter = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['key_type'] as const,
      registers: [this.registry],
    });

    this.cacheMissesCounter = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['key_type'] as const,
      registers: [this.registry],
    });

    this.cacheFetchDuration = new Histogram({
      name: 'cache_fetch_duration_ms',
      help: 'Cache fetch latency in milliseconds',
      labelNames: ['key_type'] as const,
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    this.logger.log(
      'MetricsService ready — unified Prometheus registry active',
    );
  }

  // Scrape helpers (MetricsController) //

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getMetricsAsJson(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const item of this.registry.getMetricsAsArray()) {
      result[item.name] = item;
    }
    return result;
  }

  resetMetrics(): void {
    this.registry.resetMetrics();
    this.sentimentSum = 0;
    this.sentimentCount = 0;
    this.logger.warn('All metrics reset');
  }

  // HTTP instrumentation (MetricsInterceptor)//
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const labels = { method, route, status: String(statusCode) };
    this.httpRequestCounter.inc(labels);
    this.httpRequestDuration.labels(labels).observe(durationMs / 1000);
    if (statusCode >= 400) {
      this.httpErrorCounter.inc(labels);
    }
  }

  // Job-queue instrumentation

  setJobQueueSize(queueName: string, size: number): void {
    this.jobQueueSize.labels(queueName).set(size);
  }

  recordJobProcessed(queueName: string, status: 'success' | 'failure'): void {
    this.jobsProcessed.labels(queueName, status).inc();
    if (status === 'failure') {
      this.jobsFailedCounter.labels(queueName).inc();
    }
  }

  /**
   * Call once per article that exits the processing pipeline.
   *
   * @param source  Feed identifier, e.g. "coindesk"
   * @param status  "success" | "skipped" | "duplicate"
   */
  recordArticleProcessed(
    source: string,
    status: 'success' | 'skipped' | 'duplicate' = 'success',
  ): void {
    this.articlesProcessedCounter.inc({ source, status });
  }

  /**
   * Update the global rolling-average sentiment gauge.
   * Call once per article after inference returns.
   *
   * @param score   Raw model score in [-1, 1]
   * @param source  Feed identifier (defaults to "all")
   */
  recordSentimentScore(score: number, source = 'all'): void {
    this.sentimentSum += score;
    this.sentimentCount += 1;
    this.sentimentGauge.set(
      { source },
      this.sentimentSum / this.sentimentCount,
    );
  }

  /**
   * Observe a completed inference call.
   *
   * @param durationSeconds  Elapsed wall-clock time
   * @param model            Model name/version, e.g. "finbert-v2"
   * @param task             "sentiment" | "anomaly"
   */
  recordModelInference(
    durationSeconds: number,
    model = 'default',
    task: 'sentiment' | 'anomaly' = 'sentiment',
  ): void {
    this.modelInferenceHistogram.observe({ model, task }, durationSeconds);
  }

  /**
   * Start a latency timer; call the returned function when inference ends.
   *
   * @example
   *   const end = metricsService.startInferenceTimer('finbert-v2', 'sentiment');
   *   const score = await model.infer(text);
   *   end();
   */
  startInferenceTimer(
    model = 'default',
    task: 'sentiment' | 'anomaly' = 'sentiment',
  ): () => void {
    return this.modelInferenceHistogram.startTimer({ model, task });
  }

  /**
   * Increment the anomaly counter.
   *
   * @param type      "price_spike" | "volume_surge" | "sentiment_shift" | …
   * @param severity  "low" | "medium" | "high" | "critical"
   */
  recordAnomalyDetected(
    type: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  ): void {
    this.anomaliesDetectedCounter.inc({ type, severity });
  }

  /**
   * Increment the fetch-error counter.
   *
   * @param source     Feed identifier
   * @param errorCode  HTTP status string or key, e.g. "429", "TIMEOUT"
   */
  recordFetchError(source: string, errorCode = 'UNKNOWN'): void {
    this.fetchErrorsCounter.inc({ source, error_code: errorCode });
  }

  // ── Generic Metrics Helpers ─────────────────────────────────────────────────────

  /**
   * Increment a counter metric.
   *
   * @param name  Counter metric name
   * @param labels Label values
   */
  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    const counter = this.getMetricByName(name) as Counter<string> | undefined;
    if (counter) {
      counter.inc(labels);
    }
  }

  /**
   * Record a histogram observation.
   *
   * @param name  Histogram metric name
   * @param value Value to observe
   * @param labels Label values
   */
  recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    const histogram = this.getMetricByName(name) as
      | Histogram<string>
      | undefined;
    if (histogram) {
      histogram.observe(labels, value);
    }
  }

  /**
   * Get current value of a counter metric.
   *
   * @param name  Counter metric name
   * @returns Current counter value
   */
  getCounterValue(name: string): number {
    const counter = this.getMetricByName(name) as Counter<string> | undefined;
    if (!counter) return 0;

    return this.getFirstMetricValue(name);
  }

  /**
   * Helper to get a metric by name from the registry.
   */
  private getMetricByName(
    name: string,
  ): Counter<string> | Histogram<string> | Gauge<string> | undefined {
    const metric = this.registry.getSingleMetric(name);
    return metric as
      | Counter<string>
      | Histogram<string>
      | Gauge<string>
      | undefined;
  }

  // ── Cache-specific Metrics ─────────────────────────────────────────────────────

  /**
   * Record a cache hit.
   *
   * @param keyType  Type of cache key (e.g., 'account_balance', 'contract_read')
   */
  recordCacheHit(keyType: string): void {
    this.cacheHitsCounter.inc({ key_type: keyType });
  }

  /**
   * Record a cache miss.
   *
   * @param keyType  Type of cache key (e.g., 'account_balance', 'contract_read')
   */
  recordCacheMiss(keyType: string): void {
    this.cacheMissesCounter.inc({ key_type: keyType });
  }

  /**
   * Record cache fetch duration.
   *
   * @param durationMs  Fetch duration in milliseconds
   * @param keyType     Type of cache key
   */
  recordCacheFetchDuration(durationMs: number, keyType: string): void {
    this.cacheFetchDuration.observe({ key_type: keyType }, durationMs);
  }

  /**
   * Get cache hit rate.
   *
   * @returns Hit rate between 0 and 1
   */
  getCacheHitRate(): number {
    const hits = this.getFirstMetricValue('cache_hits_total');
    const misses = this.getFirstMetricValue('cache_misses_total');
    const total = hits + misses;

    return total > 0 ? hits / total : 0;
  }

  private getFirstMetricValue(name: string): number {
    const metric = this.getMetricsAsJson()[name];
    if (!this.hasMetricValues(metric)) {
      return 0;
    }

    return metric.values[0]?.value ?? 0;
  }

  private hasMetricValues(
    metric: unknown,
  ): metric is { values: Array<{ value: number }> } {
    if (typeof metric !== 'object' || metric === null) {
      return false;
    }

    const candidate = metric as { values?: unknown };
    if (!Array.isArray(candidate.values)) {
      return false;
    }

    return candidate.values.every(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'value' in value &&
        typeof (value as { value: unknown }).value === 'number',
    );
  }

  //Dynamic metric helpers (legacy API)

  getOrCreateGauge(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Gauge<string> {
    if (!this.customGauges.has(name)) {
      this.customGauges.set(
        name,
        new Gauge({ name, help, labelNames, registers: [this.registry] }),
      );
    }
    return this.customGauges.get(name)!;
  }

  getOrCreateCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Counter<string> {
    if (!this.customCounters.has(name)) {
      this.customCounters.set(
        name,
        new Counter({ name, help, labelNames, registers: [this.registry] }),
      );
    }
    return this.customCounters.get(name)!;
  }
}

"""
Main entry point for the data processing pipeline.
"""

import sys
import os
from datetime import datetime

# Add the src directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from src.ingestion.news_fetcher import fetch_news
from src.ingestion.stellar_fetcher import get_asset_volume, get_network_overview
from src.analytics.market_analyzer import MarketAnalyzer, MarketData


def run_data_pipeline():
    """Run the complete data processing pipeline."""
    print("=" * 60)
    print("DATA PROCESSING PIPELINE")
    print("=" * 60)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    try:
        # Step 1: Fetch news data
        print("1. FETCHING CRYPTO NEWS")
        print("-" * 40)
        news_articles = fetch_news(limit=5)
        print(f"Fetched {len(news_articles)} news articles")
        
        # Calculate average sentiment (mock - in real scenario, use sentiment engine)
        if news_articles:
            # Mock sentiment calculation (replace with actual sentiment analysis)
            mock_sentiment = 0.3  # Placeholder
            print(f"Mock sentiment score: {mock_sentiment:.2f}")
        else:
            mock_sentiment = 0.0
            print("No news articles fetched, using neutral sentiment")
        
        # Step 2: Fetch Stellar on-chain data
        print("\n2. FETCHING STELLAR ON-CHAIN DATA")
        print("-" * 40)
        
        # Get XLM volume for last 24 hours
        volume_24h = get_asset_volume("XLM", hours=24)
        print(f"XLM Volume (24h): {volume_24h['total_volume']:,.2f}")
        print(f"Transactions: {volume_24h['transaction_count']}")
        
        # Get XLM volume for last 48 hours for comparison
        volume_48h = get_asset_volume("XLM", hours=48)
        
        # Calculate volume change percentage
        if volume_48h['total_volume'] > 0:
            volume_change = ((volume_24h['total_volume'] - volume_48h['total_volume']) / 
                            volume_48h['total_volume'])
            print(f"Volume Change (24h vs 48h): {volume_change:.2%}")
        else:
            volume_change = 0.0
            print("Insufficient data for volume change calculation")
        
        # Get network overview
        network_stats = get_network_overview()
        if network_stats:
            print(f"Latest Ledger: {network_stats.get('latest_ledger', 'N/A')}")
            print(f"Transaction Count: {network_stats.get('transaction_count', 0)}")
        
        # Step 3: Market Analysis
        print("\n3. MARKET ANALYSIS")
        print("-" * 40)
        
        # Create market data
        market_data = MarketData(
            sentiment_score=mock_sentiment,
            volume_change=volume_change
        )
        
        # Analyze market trend
        trend, score, metrics = MarketAnalyzer.analyze_trend(market_data)
        
        print(f"Market Health Score: {score:.2f}")
        print(f"Trend: {trend.value.upper()}")
        print(f"Sentiment Component: {metrics['sentiment_component']:.2f}")
        print(f"Volume Component: {metrics['volume_component']:.2f}")
        
        # Generate explanation
        from src.analytics.market_analyzer import get_explanation
        explanation = get_explanation(score, trend)
        print(f"\nAnalysis: {explanation}")
        
        # Step 4: Output summary
        print("\n4. PIPELINE SUMMARY")
        print("-" * 40)
        print(f"✓ News Articles Processed: {len(news_articles)}")
        print(f"✓ XLM Volume Analyzed: {volume_24h['total_volume']:,.2f}")
        print(f"✓ Market Trend: {trend.value.upper()}")
        print(f"✓ Analysis Complete: {datetime.now().strftime('%H:%M:%S')}")
        
        return {
            'success': True,
            'news_count': len(news_articles),
            'volume_xlm': volume_24h['total_volume'],
            'market_trend': trend.value,
            'health_score': score,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"\n❌ Pipeline Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }


if __name__ == "__main__":
    result = run_data_pipeline()
    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
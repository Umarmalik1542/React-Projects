import { useState, useEffect } from "react";

// Custom Hook to fetch exchange rates using ExchangeRate API
function useCurrencyCustomHook(baseCurrency) {
  const [currencyData, setCurrencyData] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function fetchCurrencyRates() {
      try {
        const response = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
        const data = await response.json();
        setCurrencyData(data.rates); // returns an object like { usd: 1, eur: 0.9, pkr: 278, ... }
      } catch (error) {
        console.error("Failed to fetch currency data:", error);
      }
    }

    if (baseCurrency) {
      fetchCurrencyRates();
    }
  }, [baseCurrency]);

  return currencyData;
}

export default useCurrencyCustomHook;

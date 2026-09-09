(function () {
  "use strict";

  var form = document.getElementById("rate-form");
  if (!form) return;

  var resultsPlaceholder = document.getElementById("results-placeholder");
  var resultsCard = document.getElementById("results-card");
  // Captured once at load, before any error message overwrites it, so the
  // original bold "Calculate My Rate" markup can be restored exactly
  // (a plain textContent restore would silently drop the <strong> tag).
  var DEFAULT_PLACEHOLDER_HTML = resultsPlaceholder.innerHTML;

  function showPlaceholder(message) {
    if (message) {
      resultsPlaceholder.textContent = message;
    } else {
      resultsPlaceholder.innerHTML = DEFAULT_PLACEHOLDER_HTML;
    }
    resultsPlaceholder.hidden = false;
    resultsCard.hidden = true;
  }

  var fields = {
    income: {
      input: document.getElementById("income"),
      error: document.getElementById("income-error"),
      min: 0,
      max: 100000000,
      label: "Desired annual take-home income"
    },
    hours: {
      input: document.getElementById("hours"),
      error: document.getElementById("hours-error"),
      min: 0.1,
      max: 168,
      label: "Working hours per week"
    },
    vacation: {
      input: document.getElementById("vacation"),
      error: document.getElementById("vacation-error"),
      min: 0,
      max: 51,
      label: "Vacation weeks per year"
    },
    tax: {
      input: document.getElementById("tax"),
      error: document.getElementById("tax-error"),
      min: 0,
      max: 99,
      label: "Estimated tax rate"
    },
    expenses: {
      input: document.getElementById("expenses"),
      error: document.getElementById("expenses-error"),
      min: 0,
      max: 100000000,
      label: "Annual business expenses"
    },
    utilization: {
      input: document.getElementById("utilization"),
      error: document.getElementById("utilization-error"),
      min: 1,
      max: 100,
      label: "Billable utilization"
    }
  };

  var currencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  var numberFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1
  });

  function clearErrors() {
    Object.keys(fields).forEach(function (key) {
      var field = fields[key];
      field.error.textContent = "";
      field.input.parentElement.classList.remove("has-error");
      field.input.removeAttribute("aria-invalid");
    });
  }

  function setError(key, message) {
    var field = fields[key];
    field.error.textContent = message;
    field.input.parentElement.classList.add("has-error");
    field.input.setAttribute("aria-invalid", "true");
  }

  function parseValue(key) {
    var raw = fields[key].input.value.trim();
    if (raw === "") return null;
    var value = Number(raw);
    if (Number.isNaN(value)) return NaN;
    return value;
  }

  function validate(values) {
    var valid = true;

    Object.keys(fields).forEach(function (key) {
      var field = fields[key];
      var value = values[key];

      if (value === null) {
        setError(key, field.label + " is required.");
        valid = false;
        return;
      }

      if (Number.isNaN(value) || !isFinite(value)) {
        setError(key, "Please enter a valid number.");
        valid = false;
        return;
      }

      // Every field's min/max is enforced generically here, so no field can
      // silently skip a bound (this previously let income/expenses/hours
      // accept unbounded or absurd values because their max was declared
      // in `fields` but never actually checked).
      if (value < field.min) {
        setError(key, field.label + " must be at least " + field.min + ".");
        valid = false;
        return;
      }

      if (value > field.max) {
        setError(key, field.label + " can't be more than " + field.max.toLocaleString("en-US") + ".");
        valid = false;
        return;
      }

      // Tax rate needs its own strict upper bound: at exactly 100% the
      // pre-tax income formula divides by zero, so 99 (the declared max)
      // isn't enough on its own if someone types 99.999.
      // (Vacation weeks don't need a separate check here: field.max is 51,
      // so the generic max check above already blocks 52+ before this
      // point, leaving at least one working week in the year.)
      if (key === "tax" && value >= 100) {
        setError(key, "Tax rate must be less than 100%.");
        valid = false;
        return;
      }
    });

    return valid;
  }

  function calculate(values) {
    var availableWorkingWeeks = 52 - values.vacation;
    var totalWorkingHours = values.hours * availableWorkingWeeks;
    var billableHours = totalWorkingHours * (values.utilization / 100);

    var requiredPreTaxIncome = values.income / (1 - values.tax / 100);
    var requiredAnnualRevenue = requiredPreTaxIncome + values.expenses;

    var hourlyRate = requiredAnnualRevenue / billableHours;
    var dailyRate = hourlyRate * 8;
    var monthlyRevenue = requiredAnnualRevenue / 12;
    var weeklyBillableHours = values.hours * (values.utilization / 100);

    return {
      hourlyRate: hourlyRate,
      dailyRate: dailyRate,
      requiredAnnualRevenue: requiredAnnualRevenue,
      monthlyRevenue: monthlyRevenue,
      annualBillableHours: billableHours,
      weeklyBillableHours: weeklyBillableHours
    };
  }

  function renderResults(results) {
    document.getElementById("result-hourly").textContent =
      currencyFormatter.format(results.hourlyRate) + "/hour";
    document.getElementById("result-daily").textContent =
      currencyFormatter.format(results.dailyRate) + "/day (8-hour workday)";
    document.getElementById("result-revenue").textContent =
      currencyFormatter.format(results.requiredAnnualRevenue);
    document.getElementById("result-monthly").textContent =
      currencyFormatter.format(results.monthlyRevenue);
    document.getElementById("result-annual-hours").textContent =
      numberFormatter.format(results.annualBillableHours) + " hours";
    document.getElementById("result-weekly-hours").textContent =
      numberFormatter.format(results.weeklyBillableHours) + " hours";

    resultsPlaceholder.hidden = true;
    resultsCard.hidden = false;
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearErrors();

    var values = {};
    Object.keys(fields).forEach(function (key) {
      values[key] = parseValue(key);
    });

    var isValid = validate(values);
    if (!isValid) {
      showPlaceholder();

      var firstErrorKey = Object.keys(fields).find(function (key) {
        return fields[key].error.textContent !== "";
      });
      if (firstErrorKey) {
        fields[firstErrorKey].input.focus();
      }
      return;
    }

    var results = calculate(values);

    // Defense in depth: validate() should already rule out every input
    // combination that could produce a non-finite result, but this guards
    // against any combination we haven't anticipated, without blaming a
    // specific field that may not be the actual cause.
    if (!isFinite(results.hourlyRate) || isNaN(results.hourlyRate)) {
      showPlaceholder("This combination of values can't be calculated. Please review your numbers and try again.");
      return;
    }

    renderResults(results);
  }

  form.addEventListener("submit", handleSubmit);

  // Allow Enter key inside any input to trigger calculation
  Object.keys(fields).forEach(function (key) {
    fields[key].input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        form.requestSubmit ? form.requestSubmit() : handleSubmit(event);
      }
    });
  });

  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
})();

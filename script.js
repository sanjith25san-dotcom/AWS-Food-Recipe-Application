
const API_URL =
    "https://rurhncpxpopdpdykbbw5egs2u40mljmj.lambda-url.ap-south-1.on.aws/";

const IMAGE_BASE_URL =
    "https://sanjith-food-recipe-762287507408-ap-south-1-an.s3.ap-south-1.amazonaws.com/images/";

let recipes = [];
let editingRecipeId = null;
let isSubmitting = false;

// =========================
// SECURITY: ESCAPE HTML
// =========================

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
}

// =========================
// RECIPE IMAGE URL
// =========================

function imageURL(recipe) {
    if (
        typeof recipe.image === "string" &&
        recipe.image.startsWith("images/")
    ) {
        return IMAGE_BASE_URL +
            encodeURIComponent(recipe.image.slice(7));
    }

    if (
        typeof recipe.image === "string" &&
        recipe.image.startsWith(IMAGE_BASE_URL)
    ) {
        return recipe.image;
    }

    const filename = String(recipe.name || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") + ".jpg";

    return IMAGE_BASE_URL + filename;
}

// =========================
// DISPLAY RECIPES
// =========================

function displayRecipes(recipeData) {
    const list = document.getElementById("recipeList");

    document.getElementById("recipeCount").textContent =
        recipeData.length +
        (recipeData.length === 1
            ? " Recipe Available"
            : " Recipes Available");

    list.replaceChildren();

    if (recipeData.length === 0) {
        list.innerHTML =
            '<div class="no-results">' +
            '<h3>🔍 No Recipes Found</h3>' +
            '<p>Try changing your search or filter.</p>' +
            '</div>';
        return;
    }

    recipeData.forEach(function(recipe) {
        const card = document.createElement("div");

        const ingredients = String(recipe.ingredients || "")
            .split("\n")
            .filter(function(item) {
                return item.trim() !== "";
            })
            .map(function(item) {
                return "<li>" + escapeHTML(item) + "</li>";
            })
            .join("");

        const steps = String(recipe.preparationSteps || "")
            .split(/\n(?=\d+\.)/)
            .filter(function(item) {
                return item.trim() !== "";
            })
            .map(function(item) {
                return "<p>" +
                    escapeHTML(item.trim()) +
                    "</p>";
            })
            .join("");

        card.innerHTML =
            '<div class="recipe-image-container">' +
            '<img class="recipe-image" src="' +
            escapeHTML(imageURL(recipe)) +
            '" alt="' +
            escapeHTML(recipe.name || "Recipe") +
            '" loading="lazy">' +
            '</div>' +

            "<h3>" +
            escapeHTML(recipe.name || "Unnamed Recipe") +
            "</h3>" +

            "<p><strong>Category:</strong> " +
            escapeHTML(recipe.category || "Not specified") +
            "</p>" +

            "<p><strong>Cooking Time:</strong> " +
            escapeHTML(recipe.cookingTime || "Not specified") +
            "</p>" +

            "<p><strong>Difficulty:</strong> " +
            escapeHTML(recipe.difficulty || "Not specified") +
            "</p>" +

            "<h4>Ingredients</h4>" +
            "<ul>" + ingredients + "</ul>" +

            "<h4>Preparation Steps</h4>" +
            "<div>" + steps + "</div>";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit Recipe";

        editButton.addEventListener("click", function() {
            editRecipe(recipe.recipeId);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete Recipe";

        deleteButton.addEventListener("click", function() {
            deleteRecipe(recipe.recipeId);
        });

        card.appendChild(editButton);
        card.appendChild(deleteButton);
        card.appendChild(document.createElement("hr"));

        list.appendChild(card);
    });
}

// =========================
// SMART SEARCH
// =========================

function matchesRecipeSearch(recipeName, searchText) {
    const nameWords = String(recipeName || "")
        .toLowerCase()
        .trim()
        .split(/\s+/);

    const searchWords = String(searchText || "")
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return searchWords.every(function(searchWord) {
        return nameWords.some(function(nameWord) {
            return nameWord.startsWith(searchWord);
        });
    });
}

// =========================
// SEARCH, FILTER AND SORT
// =========================

function applyFilters() {
    const searchText = document
        .getElementById("searchInput")
        .value
        .trim();

    const selectedCategory = document
        .getElementById("categoryFilter")
        .value;

    const sortOption = document
        .getElementById("sortFilter")
        .value;

    let filteredRecipes = recipes.filter(function(recipe) {
        return (
            matchesRecipeSearch(recipe.name, searchText) &&
            (
                selectedCategory === "all" ||
                recipe.category === selectedCategory
            )
        );
    });

    if (sortOption === "nameAsc") {
        filteredRecipes.sort(function(a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
    }

    else if (sortOption === "nameDesc") {
        filteredRecipes.sort(function(a, b) {
            return String(b.name).localeCompare(String(a.name));
        });
    }

    else if (sortOption === "newest") {
        filteredRecipes.sort(function(a, b) {
            return (
                (Date.parse(b.createdAt) || 0) -
                (Date.parse(a.createdAt) || 0)
            );
        });
    }

    else if (sortOption === "oldest") {
        filteredRecipes.sort(function(a, b) {
            return (
                (Date.parse(a.createdAt) || 0) -
                (Date.parse(b.createdAt) || 0)
            );
        });
    }

    displayRecipes(filteredRecipes);
}

function searchRecipes() {
    applyFilters();
}

function clearSearch() {
    document.getElementById("searchInput").value = "";
    applyFilters();
}

function filterByCategory() {
    applyFilters();
}

function sortRecipes() {
    applyFilters();
}

function resetFilters() {
    document.getElementById("searchInput").value = "";
    document.getElementById("categoryFilter").value = "all";
    document.getElementById("sortFilter").value = "default";

    displayRecipes(recipes);
}

// =========================
// LOAD RECIPES
// =========================

async function loadRecipes() {
    const list = document.getElementById("recipeList");

    list.innerHTML =
        '<div class="loading-message">' +
        '<p>Loading recipes...</p>' +
        '</div>';

    try {
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error("Unable to load recipes");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("Unexpected recipe data");
        }

        recipes = data;
        applyFilters();

    } catch (error) {
        console.error("Error loading recipes:", error);

        document.getElementById("recipeCount").textContent = "";

        list.innerHTML =
            '<div class="no-results">' +
            '<h3>⚠️ Unable to Load Recipes</h3>' +
            '<p>Please check your internet connection and try again.</p>' +
            '</div>';
    }
}

// =========================
// CLOUDFLARE CAPTCHA
// =========================

function resetCaptcha() {
    if (
        window.turnstile &&
        typeof window.turnstile.reset === "function"
    ) {
        try {
            window.turnstile.reset();
        } catch (error) {
            console.warn("CAPTCHA reset failed:", error);
        }
    }
}

function updateCaptchaVisibility() {
    const file = document
        .getElementById("recipeImage")
        .files[0];

    const captchaContainer = document
        .getElementById("imageUploadCaptcha");

    captchaContainer.style.display =
        file ? "block" : "none";

    if (!file) {
        resetCaptcha();
    }
}

// =========================
// EDIT RECIPE
// =========================

function editRecipe(recipeId) {
    const recipe = recipes.find(function(item) {
        return String(item.recipeId) === String(recipeId);
    });

    if (!recipe) {
        alert("Recipe not found.");
        return;
    }

    editingRecipeId = recipe.recipeId;

    const fields = {
        recipeName: "name",
        recipeCategory: "category",
        cookingTime: "cookingTime",
        difficulty: "difficulty",
        ingredients: "ingredients",
        preparationSteps: "preparationSteps"
    };

    Object.entries(fields).forEach(function(entry) {
        const inputId = entry[0];
        const recipeField = entry[1];

        document.getElementById(inputId).value =
            recipe[recipeField] || "";
    });

    document.getElementById("recipeImage").value = "";

    updateCaptchaVisibility();

    document.getElementById("submitRecipeButton").textContent =
        "Update Recipe";

    document.getElementById("addRecipeForm").scrollIntoView({
        behavior: "smooth"
    });
}

// =========================
// CANCEL EDIT
// =========================

function cancelEdit() {
    editingRecipeId = null;

    document.getElementById("addRecipeForm").reset();

    document.getElementById("submitRecipeButton").textContent =
        "Add Recipe";

    updateCaptchaVisibility();
}

// =========================
// DELETE RECIPE
// =========================

async function deleteRecipe(recipeId) {
    const confirmed = confirm(
        "Are you sure you want to delete this recipe?"
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(API_URL, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                recipeId: recipeId
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.error || "Delete operation failed"
            );
        }

        alert("Recipe deleted successfully!");

        await loadRecipes();

    } catch (error) {
        console.error("Error deleting recipe:", error);

        alert(
            "Unable to delete recipe. Please try again."
        );
    }
}

// =========================
// UPLOAD IMAGE TO AMAZON S3
// =========================

async function uploadRecipeImage(file) {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        throw new Error(
            "Only JPG, PNG and WebP images are allowed."
        );
    }

    if (
        file.size < 1 ||
        file.size > 5 * 1024 * 1024
    ) {
        throw new Error(
            "Image must be 5 MB or smaller."
        );
    }

    if (
        !window.turnstile ||
        typeof window.turnstile.getResponse !== "function"
    ) {
        throw new Error(
            "CAPTCHA has not loaded. Please try again."
        );
    }

    const token = window.turnstile.getResponse();

    if (!token) {
        throw new Error(
            "Complete the CAPTCHA before uploading."
        );
    }

    // Request permission from AWS Lambda
    const prepareResponse = await fetch(
        API_URL + "image-upload",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                turnstileToken: token,
                contentType: file.type,
                fileSize: file.size
            })
        }
    );

    const prepared = await prepareResponse.json();

    if (!prepareResponse.ok) {
        throw new Error(
            prepared.error ||
            "Image upload authorization failed."
        );
    }

    if (
        !prepared.upload ||
        !prepared.imageKey
    ) {
        throw new Error("Invalid upload response.");
    }

    // Upload image directly to Amazon S3
    const formData = new FormData();

    Object.entries(
        prepared.upload.fields
    ).forEach(function(entry) {
        formData.append(entry[0], entry[1]);
    });

    formData.append("file", file);

    const uploadResponse = await fetch(
        prepared.upload.url,
        {
            method: "POST",
            body: formData
        }
    );

    if (!uploadResponse.ok) {
        throw new Error(
            "Image upload failed. Check S3 settings."
        );
    }

    return prepared.imageKey;
}

// =========================
// IMAGE FILE SELECTION
// =========================

document
    .getElementById("recipeImage")
    .addEventListener(
        "change",
        updateCaptchaVisibility
    );

// =========================
// ADD OR UPDATE RECIPE
// =========================

document
    .getElementById("addRecipeForm")
    .addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            if (!event.target.checkValidity()) {
                event.target.reportValidity();
                return;
            }

            if (isSubmitting) {
                return;
            }

            const selectedFile = document
                .getElementById("recipeImage")
                .files[0];

            const recipeId =
                editingRecipeId !== null
                    ? editingRecipeId
                    : Date.now().toString();

            const recipeData = {
                recipeId: recipeId,

                name: document
                    .getElementById("recipeName")
                    .value.trim(),

                category: document
                    .getElementById("recipeCategory")
                    .value.trim(),

                cookingTime: document
                    .getElementById("cookingTime")
                    .value.trim(),

                difficulty: document
                    .getElementById("difficulty")
                    .value,

                ingredients: document
                    .getElementById("ingredients")
                    .value.trim(),

                preparationSteps: document
                    .getElementById("preparationSteps")
                    .value.trim()
            };

            const submitButton = document
                .getElementById("submitRecipeButton");

            isSubmitting = true;
            submitButton.disabled = true;

            submitButton.textContent =
                selectedFile
                    ? "Uploading image..."
                    : (
                        editingRecipeId !== null
                            ? "Updating..."
                            : "Adding..."
                    );

            try {
                // Upload selected image first
                if (selectedFile) {
                    recipeData.image =
                        await uploadRecipeImage(selectedFile);
                }

                submitButton.textContent =
                    "Saving recipe...";

                // Save recipe in DynamoDB
                const response = await fetch(
                    API_URL,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(recipeData)
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.error ||
                        "Unable to save recipe."
                    );
                }

                if (editingRecipeId !== null) {
                    alert(
                        "Recipe updated successfully!"
                    );
                } else {
                    alert(
                        "Recipe added successfully!"
                    );
                }

                editingRecipeId = null;

                event.target.reset();

                updateCaptchaVisibility();

                await loadRecipes();

            } catch (error) {
                console.error(
                    "Error saving recipe:",
                    error
                );

                alert(
                    error.message ||
                    "Unable to save recipe. Please try again."
                );

                resetCaptcha();

            } finally {
                isSubmitting = false;
                submitButton.disabled = false;

                submitButton.textContent =
                    editingRecipeId === null
                        ? "Add Recipe"
                        : "Update Recipe";
            }
        }
    );

// =========================
// START APPLICATION
// =========================

loadRecipes();

// =========================
// LIVE SEARCH
// =========================

document
    .getElementById("searchInput")
    .addEventListener("input", applyFilters);

// =========================
// SEARCH AUTOCOMPLETE
// =========================

const searchInput =
    document.getElementById("searchInput");

const searchSuggestions =
    document.getElementById("searchSuggestions");

function hideSuggestions() {
    searchSuggestions.hidden = true;

    searchInput.setAttribute(
        "aria-expanded",
        "false"
    );
}

function showSuggestions() {
    const searchText =
        searchInput.value.trim();

    searchSuggestions.replaceChildren();

    if (!searchText) {
        hideSuggestions();
        return;
    }

    const matchingRecipes = recipes
        .filter(function(recipe) {
            return matchesRecipeSearch(
                recipe.name,
                searchText
            );
        })
        .sort(function(a, b) {
            return String(a.name || "").localeCompare(
                String(b.name || "")
            );
        });

    if (matchingRecipes.length === 0) {
        const emptyMessage =
            document.createElement("div");

        emptyMessage.className =
            "suggestion-empty";

        emptyMessage.textContent =
            "No matching recipes found";

        searchSuggestions.appendChild(
            emptyMessage
        );

    } else {
        matchingRecipes.forEach(function(recipe) {
            const suggestion =
                document.createElement("button");

            suggestion.type = "button";
            suggestion.className =
                "suggestion-item";

            suggestion.setAttribute(
                "role",
                "option"
            );

            const icon =
                document.createElement("span");

            icon.className =
                "suggestion-icon";

            icon.textContent = "🔍";

            const name =
                document.createElement("span");

            name.textContent =
                recipe.name || "Unnamed Recipe";

            suggestion.appendChild(icon);
            suggestion.appendChild(name);

            suggestion.addEventListener(
                "click",
                function() {
                    searchInput.value =
                        recipe.name || "";

                    applyFilters();
                    hideSuggestions();

                    document
                        .getElementById("recipes")
                        .scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                        });
                }
            );

            searchSuggestions.appendChild(
                suggestion
            );
        });
    }

    searchSuggestions.hidden = false;

    searchInput.setAttribute(
        "aria-expanded",
        "true"
    );
}

searchInput.addEventListener(
    "input",
    showSuggestions
);

searchInput.addEventListener(
    "focus",
    showSuggestions
);

document.addEventListener(
    "click",
    function(event) {
        if (
            !event.target.closest(
                ".search-input-container"
            )
        ) {
            hideSuggestions();
        }
    }
);

searchInput.addEventListener(
    "keydown",
    function(event) {
        if (event.key === "Escape") {
            hideSuggestions();
        }
    }
);

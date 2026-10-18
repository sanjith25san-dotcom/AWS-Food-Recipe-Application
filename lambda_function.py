
import json
import os
import re
import uuid
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


# =========================
# AWS SERVICES
# =========================

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("Recipes")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("Recipes")
s3 = boto3.client(
    "s3",
    region_name="ap-south-1",
    endpoint_url="https://s3.ap-south-1.amazonaws.com"
)

IMAGE_BUCKET = os.environ.get("RECIPE_IMAGE_BUCKET", "")
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET_KEY", "")

EXPECTED_HOSTNAME = (
    "sanjith-food-recipe-762287507408-ap-south-1-an."
    "s3-website.ap-south-1.amazonaws.com"
)

MAX_IMAGE_SIZE = 5 * 1024 * 1024

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
}

IMAGE_KEY_PATTERN = re.compile(
    r"^images/[0-9a-f]{32}\.(jpg|png|webp)$"
)


# =========================
# HTTP RESPONSE
# =========================

def response(status_code, data):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(data)
    }

# =========================
# READ REQUEST BODY
# =========================

def parse_body(event):
    body = event.get("body", {})

    if isinstance(body, str):
        body = json.loads(body)

    if not isinstance(body, dict):
        raise ValueError("Invalid request body")

    return body


# =========================
# VALIDATE RECIPE
# =========================

def validate_recipe(body):
    required_fields = [
        "recipeId",
        "name",
        "category",
        "cookingTime",
        "difficulty",
        "ingredients",
        "preparationSteps"
    ]

    for field in required_fields:
        value = body.get(field)

        if not isinstance(value, str) or not value.strip():
            return f"{field} is required"

    return None


# =========================
# FIND EXISTING RECIPE
# =========================

def get_existing_recipe(recipe_id):
    result = table.get_item(
        Key={"recipeId": recipe_id}
    )

    return result.get("Item")


# =========================
# VERIFY CLOUDFLARE CAPTCHA
# =========================

def verify_turnstile(token):
    if not TURNSTILE_SECRET or not isinstance(token, str) or not token:
        return False

    try:
        payload = urllib.parse.urlencode({
            "secret": TURNSTILE_SECRET,
            "response": token
        }).encode("utf-8")

        request = urllib.request.Request(
            "https://challenges.cloudflare.com/"
            "turnstile/v0/siteverify",
            data=payload,
            method="POST"
        )

        with urllib.request.urlopen(request, timeout=8) as result:
            verification = json.loads(
                result.read().decode("utf-8")
            )

        return (
            verification.get("success") is True
            and verification.get("hostname") == EXPECTED_HOSTNAME
        )

    except Exception:
        return False


# =========================
# CREATE IMAGE UPLOAD
# =========================

def create_image_upload(event):
    try:
        body = parse_body(event)

        content_type = body.get("contentType")
        file_size = body.get("fileSize")

        if content_type not in ALLOWED_IMAGE_TYPES:
            return response(400, {
                "error": "Only JPG, PNG and WebP images are allowed"
            })

        if (
            type(file_size) is not int
            or not (1 <= file_size <= MAX_IMAGE_SIZE)
        ):
            return response(400, {
                "error": "Image must be 5 MB or smaller"
            })

        if not verify_turnstile(body.get("turnstileToken")):
            return response(403, {
                "error": "CAPTCHA verification failed"
            })

        if not IMAGE_BUCKET:
            return response(500, {
                "error": "Image bucket is not configured"
            })

        image_key = (
            f"images/{uuid.uuid4().hex}"
            f"{ALLOWED_IMAGE_TYPES[content_type]}"
        )

        upload = s3.generate_presigned_post(
            Bucket=IMAGE_BUCKET,
            Key=image_key,
            Fields={
                "Content-Type": content_type
            },
            Conditions=[
                {
                    "Content-Type": content_type
                },
                [
                    "content-length-range",
                    1,
                    MAX_IMAGE_SIZE + 4096
                ]
            ],
            ExpiresIn=60
        )

        return response(200, {
            "upload": upload,
            "imageKey": image_key
        })

    except (ValueError, TypeError, json.JSONDecodeError):
        return response(400, {
            "error": "Invalid image-upload request"
        })

    except Exception:
        return response(500, {
            "error": "Unable to prepare image upload"
        })


# =========================
# VALIDATE UPLOADED IMAGE
# =========================

def validate_uploaded_image(image_key):
    if not isinstance(image_key, str):
        return False

    if not IMAGE_KEY_PATTERN.fullmatch(image_key):
        return False

    if not IMAGE_BUCKET:
        return False

    try:
        result = s3.head_object(
            Bucket=IMAGE_BUCKET,
            Key=image_key
        )

        size = result.get("ContentLength", 0)
        content_type = result.get("ContentType", "")

        expected_extension = ALLOWED_IMAGE_TYPES.get(
            content_type
        )

        return (
            1 <= size <= MAX_IMAGE_SIZE
            and expected_extension is not None
            and image_key.endswith(expected_extension)
        )

    except ClientError:
        return False


# =========================
# BUILD RECIPE
# =========================

def build_recipe(body, existing_item=None):
    recipe = dict(existing_item or {})

    fields = [
        "recipeId",
        "name",
        "category",
        "cookingTime",
        "difficulty",
        "ingredients",
        "preparationSteps"
    ]

    for field in fields:
        recipe[field] = body[field].strip()

    if not recipe.get("createdAt"):
        recipe["createdAt"] = datetime.now(
            timezone.utc
        ).isoformat()

    return recipe


# =========================
# SAVE RECIPE
# =========================

def save_recipe(event, require_existing=False):
    try:
        body = parse_body(event)

        error = validate_recipe(body)

        if error:
            return response(400, {
                "error": error
            })

        recipe_id = body["recipeId"].strip()
        body["recipeId"] = recipe_id

        existing = get_existing_recipe(recipe_id)

        if require_existing and existing is None:
            return response(404, {
                "error": "Recipe not found"
            })

        recipe = build_recipe(body, existing)

        # Save a newly uploaded image only after
        # checking that it exists in S3.
        if "image" in body:
            image_key = body["image"]

            if not validate_uploaded_image(image_key):
                return response(400, {
                    "error": (
                        "Uploaded image could not be verified. "
                        "Please upload it again."
                    )
                })

            recipe["image"] = image_key

        condition = (
            "attribute_exists(recipeId)"
            if existing is not None
            else "attribute_not_exists(recipeId)"
        )

        table.put_item(
            Item=recipe,
            ConditionExpression=condition
        )

        return response(200, {
            "message": (
                "Recipe updated successfully"
                if existing is not None
                else "Recipe added successfully"
            )
        })

    except (ValueError, TypeError, json.JSONDecodeError):
        return response(400, {
            "error": "Invalid JSON request"
        })

    except ClientError as exc:
        error_code = exc.response.get(
            "Error", {}
        ).get("Code")

        if error_code == "ConditionalCheckFailedException":
            return response(409, {
                "error": "Recipe changed during saving. Please retry."
            })

        return response(500, {
            "error": "Unable to save recipe"
        })

    except Exception:
        return response(500, {
            "error": "Unable to save recipe"
        })


# =========================
# MAIN LAMBDA HANDLER
# =========================

def lambda_handler(event, context):
    method = event.get(
        "requestContext", {}
    ).get(
        "http", {}
    ).get(
        "method",
        "GET"
    )

    path = event.get("rawPath", "/")

    # IMAGE UPLOAD
    if method == "POST" and path == "/image-upload":
        return create_image_upload(event)

    # GET ALL RECIPES
    if method == "GET":
        try:
            items = []
            args = {}

            while True:
                result = table.scan(**args)

                items.extend(
                    result.get("Items", [])
                )

                if "LastEvaluatedKey" not in result:
                    break

                args["ExclusiveStartKey"] = (
                    result["LastEvaluatedKey"]
                )

            return response(200, items)

        except Exception:
            return response(500, {
                "error": "Unable to retrieve recipes"
            })

    # ADD OR UPDATE RECIPE
    if method == "POST":
        return save_recipe(event)

    if method == "PUT":
        return save_recipe(
            event,
            require_existing=True
        )

    # DELETE RECIPE
    if method == "DELETE":
        try:
            body = parse_body(event)
            recipe_id = body.get("recipeId")

            if (
                not isinstance(recipe_id, str)
                or not recipe_id.strip()
            ):
                return response(400, {
                    "error": "Recipe ID is required"
                })

            table.delete_item(
                Key={
                    "recipeId": recipe_id
                }
            )

            return response(200, {
                "message": "Recipe deleted successfully"
            })

        except (ValueError, TypeError, json.JSONDecodeError):
            return response(400, {
                "error": "Invalid JSON request"
            })

        except Exception:
            return response(500, {
                "error": "Unable to delete recipe"
            })

    return response(405, {
        "error": "Method not allowed"
    })

from flask import Flask, jsonify, request
import random

app = Flask(__name__)

CITY_TEMPERATURES = {
    "London": 15,
    "Paris": 18,
    "NewYork": 22,
    "Tokyo": 25,
    "Sydney": 28,
    "Moscow": 5,
    "Dubai": 35,
    "Berlin": 12,
    "Rome": 20,
    "Madrid": 23,
    "Szeged": 31,
}
@app.route('/random', methods=['GET'])
def get_random_number():
	return jsonify({"number": random.randint(0, 40)})

@app.route('/weather', methods=['GET'])
def get_weather():
    city = request.args.get('city')
    
    if not city:
        return jsonify({"error": "City parameter is required"}), 400
    
    temperature = CITY_TEMPERATURES.get(city)
    
    if temperature is None:
        return jsonify({"error": f"City '{city}' not found"}), 404
    
    return jsonify({"temperature": temperature})

@app.route('/get-random-city-temperature', methods=['GET'])
def get_random_city_temperature():
    city = random.choice(list(CITY_TEMPERATURES.keys()))
    temperature = CITY_TEMPERATURES[city]
    return jsonify({"city": city, "temperature": temperature})

if __name__ == '__main__':
	app.run(debug=True)
